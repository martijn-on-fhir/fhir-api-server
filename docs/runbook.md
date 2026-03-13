# Runbook

Operationele procedures voor de FHIR API Server.

## Startup

### Vereisten
- Docker en Docker Compose geïnstalleerd
- `.env` bestand of `CORS_ORIGIN` environment variable ingesteld

### Starten

```bash
CORS_ORIGIN=https://app.example.com docker compose up -d
```

### Verificatie

```bash
# Wacht tot health check slaagt (max ~30s)
curl http://localhost:3000/health/ready
# Verwacht: {"status":"ready","checks":{"database":"up"}}

# Controleer alle services
docker compose ps
```

| Service | URL | Doel |
|---------|-----|------|
| FHIR API | http://localhost:3000 | API + Swagger UI (`/api`) |
| Grafana | http://localhost:3001 | Dashboard + alerting (admin/admin) |
| Jaeger | http://localhost:16686 | Distributed tracing |
| Prometheus | http://localhost:9090 | Metrics + targets |
| Loki | http://localhost:3100 | Log aggregatie (via Grafana Explore) |

### Eerste keer

Bij de eerste start worden conformance resources automatisch geïmporteerd vanuit `file-import/`. Dit kan enkele minuten duren.

---

## Shutdown

```bash
# Graceful stop (data blijft bewaard in volumes)
docker compose down

# Volledig opschonen inclusief data (DESTRUCTIEF)
docker compose down -v
```

NestJS heeft `enableShutdownHooks()` — lopende requests worden afgerond voor de server stopt.

---

## Scaling

### Horizontaal (meerdere API instances)

```bash
docker compose up -d --scale fhir-api=3
```

**Let op:**
- Zet `BACKUP_INTERVAL_MS=0` op extra instances (alleen 1 instance maakt backups)
- In-memory cache is per instance — geen inconsistentie bij read-only conformance data (max 5 min TTL)
- Alle instances delen dezelfde MongoDB

### Verticaal

Pas MongoDB pool size aan op basis van load:
```
MONGODB_POOL_SIZE=20 MONGODB_MIN_POOL_SIZE=5
```

---

## Troubleshooting

| Symptoom | Check | Oplossing |
|----------|-------|-----------|
| API returns 503 | `curl localhost:3000/health` | MongoDB down → `docker compose restart mongo` |
| Hoge latency (p95 > 500ms) | Grafana dashboard → Latency panels | Check `/admin/index-stats`, verlaag `SLOW_QUERY_THRESHOLD_MS` voor meer detail |
| 429 Too Many Requests | Grafana → Error Rate | Verhoog `RATE_LIMIT_MAX` of check of client te veel requests stuurt |
| Backup faalt | Container logs: `docker compose logs fhir-api` | Check of `mongodump` beschikbaar is (`apk add mongodb-tools` in Dockerfile) |
| Circuit breaker open | `curl localhost:3000/health` → circuitBreakers | Upstream service (JWKS) onbereikbaar. Wacht op auto-recovery (30s) of herstart |
| Hoog geheugengebruik | Grafana → Memory panel of `/health` | Check `MAX_COUNT`, `MAX_BUNDLE_ENTRIES`, `MAX_INCLUDE_RESULTS`. Herstart indien memory leak. |
| Geen data in Grafana | Prometheus → Targets (`localhost:9090/targets`) | Check of alle targets "UP" zijn |
| Geen logs in Loki | Grafana → Explore → Loki | Check `docker compose logs promtail` |

### Handige commando's

```bash
# Database statistieken
curl http://localhost:3000/admin/db-stats

# Index gebruik
curl http://localhost:3000/admin/index-stats

# Handmatige backup (SERVER_BACKUP_ENABLED=true vereist)
curl -X POST http://localhost:3000/admin/backup

# Beschikbare backups
curl http://localhost:3000/admin/backups

# Container logs
docker compose logs -f fhir-api
docker compose logs -f mongo

# MongoDB shell
docker compose exec mongo mongosh --eval "db.fhir_resources.countDocuments()"
```

---

## Logs bekijken

### Via Grafana (Loki)

1. Open Grafana op `http://localhost:3001`
2. Ga naar Explore (kompas icoon)
3. Selecteer "Loki" als datasource
4. Query: `{container=~".*fhir-api.*"}`
5. Filter op level: `{container=~".*fhir-api.*"} | json | level="ERROR"`

### Via Docker

```bash
# Alle logs
docker compose logs -f fhir-api

# Alleen errors (JSON structured logs)
docker compose logs fhir-api | grep '"level":"error"'
```

---

## Monitoring & Alerting

### Geconfigureerde alerts (Grafana)

| Alert | Drempel | Severity |
|-------|---------|----------|
| High Error Rate | > 1% 5xx responses gedurende 5 min | Critical |
| High p95 Latency | > 500ms gedurende 5 min | Warning |
| MongoDB Connections High | > 80% capaciteit gedurende 5 min | Warning |

Alerts zijn zichtbaar in Grafana → Alerting. Configureer een contact point (email, Slack, PagerDuty) via Grafana UI → Alerting → Contact points.

### Disk monitoring

Disk monitoring wordt afgehandeld door het host OS of cloud platform (Azure Monitor, AWS CloudWatch). Monitor:
- MongoDB data volume (`mongo-data`)
- Backup volume (`backups`)
- Loki log volume (`loki-data`)
