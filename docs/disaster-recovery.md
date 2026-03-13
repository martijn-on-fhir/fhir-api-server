# Disaster Recovery Plan

## Scope

Dit plan dekt de recovery van een single-tenant FHIR API Server deployment bestaande uit:
- FHIR API applicatie (Docker container)
- MongoDB database (Docker container met `mongo-data` volume)
- Backups (Docker `backups` volume)
- Monitoring stack (Prometheus, Grafana, Loki, Jaeger)

## RTO / RPO

| Metric | Waarde | Toelichting |
|--------|--------|-------------|
| **RPO** | Configureerbaar, standaard 24 uur | `BACKUP_INTERVAL_MS` bepaalt maximaal dataverlies |
| **RTO** | < 10 minuten | Nieuwe containers starten + restore + verificatie |

## Scenario's

### 1. Container crash

**Impact:** Geen dataverlies. Korte onderbreking.

**Recovery:** Automatisch via Docker `restart: unless-stopped` policy.

**Verificatie:**
```bash
curl http://localhost:3000/health/ready
docker compose ps
```

### 2. MongoDB data corruptie

**Impact:** Database onbruikbaar. Data mogelijk verloren.

**Recovery:**
```bash
# Stop de API om verdere corruptie te voorkomen
docker compose stop fhir-api

# Controleer beschikbare backups
curl http://localhost:3000/admin/backups
# Of: ls de backup directory
docker compose exec fhir-api ls /app/backups/

# Restore de meest recente backup
# Via API (als de server nog draait):
curl -X POST http://localhost:3000/admin/backup/restore \
  -H 'Content-Type: application/json' \
  -d '{"filename": "fhir-backup-DATUM.gz"}'

# Via CLI (als de server niet draait):
docker compose exec fhir-api \
  mongorestore --uri="mongodb://mongo:27017/fhir?replicaSet=rs0" \
  --archive=/app/backups/fhir-backup-DATUM.gz --gzip --drop

# Start de API opnieuw
docker compose start fhir-api
```

**Verificatie:**
```bash
curl http://localhost:3000/admin/db-stats
# Vergelijk document counts met de backup metadata
```

### 3. Host disk failure / volledig verlies

**Impact:** Alle data verloren inclusief lokale backups.

**Recovery:**
```bash
# Op een nieuwe host:
git clone <repository-url>
cd fhir-api-server

# Kopieer backup van off-site opslag
# Voorbeeld met AWS S3:
aws s3 cp s3://bucket/backups/fhir-backup-DATUM.gz ./backups/

# Start de stack
CORS_ORIGIN=https://app.example.com docker compose up -d

# Wacht tot MongoDB healthy is
docker compose exec mongo mongosh --eval "rs.status().ok"

# Restore de backup
docker compose exec fhir-api \
  mongorestore --uri="mongodb://mongo:27017/fhir?replicaSet=rs0" \
  --archive=/app/backups/fhir-backup-DATUM.gz --gzip --drop

# Herstart de API om caches te refreshen
docker compose restart fhir-api
```

**Verificatie:**
```bash
curl http://localhost:3000/health/ready
curl http://localhost:3000/admin/db-stats
```

### 4. Accidentele data verwijdering

**Impact:** Specifieke resources verloren.

**Recovery opties:**

**Optie A — Individuele resource herstellen uit versie-historie:**
```bash
# Zoek de laatste versie voor verwijdering
GET /fhir/Patient/{id}/_history

# vRead de gewenste versie
GET /fhir/Patient/{id}/_history/{versionId}

# Maak de resource opnieuw aan met PUT
PUT /fhir/Patient/{id}
```

**Optie B — Volledige restore uit backup:**
Zie scenario 2 hierboven.

### 5. Docker volume verlies

**Impact:** Data verloren, containers intact.

**Recovery:** Zelfde als scenario 3, maar geen herinstallatie nodig. Start stack opnieuw en restore uit off-site backup.

## Off-site backup strategie

Kopieer backups regelmatig naar externe opslag. Voorbeeld cron job:

```bash
# Elke 6 uur backups kopiëren naar S3
0 */6 * * * docker cp fhir-api-server-fhir-api-1:/app/backups/ /tmp/fhir-backups/ && \
  aws s3 sync /tmp/fhir-backups/ s3://mijn-bucket/fhir-backups/ --delete && \
  rm -rf /tmp/fhir-backups/
```

Alternatieven:
- **Azure Blob Storage:** `az storage blob upload-batch`
- **Google Cloud Storage:** `gsutil rsync`
- **Rsync naar remote server:** `rsync -avz /tmp/fhir-backups/ user@remote:/backups/`

## DR test procedure

**Frequentie:** Kwartaal

1. Maak een verse backup: `POST /admin/backup`
2. Noteer document counts: `GET /admin/db-stats`
3. Start een schone omgeving (andere host of Docker project)
4. Restore de backup
5. Vergelijk document counts
6. Voer een smoke test uit: create Patient, search, read, delete
7. Documenteer resultaat en eventuele afwijkingen
