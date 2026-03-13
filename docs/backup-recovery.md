# Backup & Recovery

## Overzicht

De FHIR API server heeft twee backup mechanismen:

1. **Automated backups** — Scheduled mongodump naar `/app/backups` (Docker volume)
2. **API-triggered backups** — On-demand via `POST /admin/backup`

Beide produceren gecomprimeerde mongodump archives (`.gz`) die alle collecties bevatten.

## Configuratie

| Env var | Default | Beschrijving |
|---------|---------|-------------|
| `BACKUP_DIR` | `./backups` | Directory voor backup bestanden |
| `BACKUP_INTERVAL_MS` | `86400000` (24h) | Interval voor automatische backups. `0` = disabled |
| `BACKUP_RETENTION_COUNT` | `7` | Maximaal aantal backups bewaren |
| `SERVER_BACKUP_ENABLED` | `false` | Enable `POST /admin/backup` endpoint |
| `SERVER_BACKUP_RESTORE_ENABLED` | `false` | Enable `POST /admin/backup/restore` endpoint |

## Automatische backups

Bij het starten van de server wordt de backup scheduler geactiveerd (tenzij `BACKUP_INTERVAL_MS=0`). Standaard wordt elke 24 uur een backup gemaakt. Oude backups worden automatisch opgeruimd op basis van `BACKUP_RETENTION_COUNT`.

### Docker-compose

De docker-compose configuratie mount een `backups` volume op `/app/backups`. Backups overleven container restarts.

## Handmatige backup

```bash
# Via API (SERVER_BACKUP_ENABLED=true vereist)
curl -X POST http://localhost:3000/admin/backup

# Respons:
{
  "filename": "fhir-backup-2026-03-14T10-00-00-000Z.gz",
  "path": "/app/backups/fhir-backup-2026-03-14T10-00-00-000Z.gz",
  "sizeBytes": 1234567,
  "createdAt": "2026-03-14T10:00:00.000Z",
  "collections": {
    "fhir_resources": 1500,
    "fhir_resource_history": 3000,
    "conformance_resources": 450,
    "jobs": 2
  }
}

# Lijst van beschikbare backups
curl http://localhost:3000/admin/backups
```

## Recovery

### Restore via API

```bash
# SERVER_BACKUP_RESTORE_ENABLED=true vereist
curl -X POST http://localhost:3000/admin/backup/restore \
  -H 'Content-Type: application/json' \
  -d '{"filename": "fhir-backup-2026-03-14T10-00-00-000Z.gz"}'
```

**Let op:** Dit dropt alle bestaande collecties en herstelt vanuit de backup.

### Restore via CLI (buiten de applicatie)

```bash
# Vanuit Docker container
docker exec fhir-api-server-fhir-api-1 \
  mongorestore --uri="mongodb://mongo:27017/fhir?replicaSet=rs0" \
  --archive=/app/backups/fhir-backup-2026-03-14T10-00-00-000Z.gz \
  --gzip --drop

# Vanuit host (als MongoDB tools geïnstalleerd zijn)
mongorestore --uri="mongodb://localhost:27017/fhir" \
  --archive=backups/fhir-backup-2026-03-14T10-00-00-000Z.gz \
  --gzip --drop
```

### Backup kopiëren van Docker volume naar host

```bash
docker cp fhir-api-server-fhir-api-1:/app/backups/ ./local-backups/
```

## RTO/RPO

| Metric | Waarde |
|--------|--------|
| **RPO** (Recovery Point Objective) | Maximaal 24 uur dataverlies (bij standaard interval) |
| **RTO** (Recovery Time Objective) | < 5 minuten (restore + server herstart) |

Om RPO te verkorten, verlaag `BACKUP_INTERVAL_MS` (bijv. `3600000` voor elk uur).

## Aanbevelingen voor productie

1. **Externe opslag** — Kopieer backups naar S3/Azure Blob/GCS via een cron job of sidecar container
2. **Test restores regelmatig** — Maandelijks een restore testen op een staging omgeving
3. **Monitor backup succes** — Check logs voor "Backup complete" of "Backup failed" berichten
4. **MongoDB Atlas** — Overweeg MongoDB Atlas met ingebouwde continuous backups en point-in-time recovery
