# Production Checklist

Resterende stappen voordat de disclaimer "niet gevalideerd voor productiegebruik met patiëntdata" verwijderd kan worden.

## 1. Security validatie

- [ ] Penetration test (extern) — OWASP Top 10, FHIR-specifieke aanvallen
- [ ] Dependency audit: `npm audit` clean op productie dependencies
- [ ] TLS termination configureren op reverse proxy (Nginx/Traefik)
- [ ] SMART on FHIR configureren met echte authorization server (Keycloak/Auth0)
- [ ] Review van alle env vars: geen secrets in defaults of docker-compose

## 2. Load test op productie-hardware

- [x] Dataset: schaalbaar seed script (`--scale N`). Scale=1: ~1500, scale=10: ~15K, scale=100: ~150K resources
- [x] Load test met 15K resources (Docker): reads p95=10.7ms, searches p95=43.3ms, writes p95=29.7ms, 0% errors
- [x] Thresholds gevalideerd: alle ruim binnen targets (reads <200ms, search <500ms, errors <1%)
- [x] MongoDB connection pool: default 10 connections voldoende bij 140 req/s, max 49 VUs
- [ ] Memory profiling: 299 MB heap na 2 min load test. Langere soak test (24h) op productie-hardware aanbevolen

## 3. Backup & recovery

- [x] Geautomatiseerde MongoDB backup pipeline (BackupService met scheduled mongodump, retention)
- [x] Recovery procedure gedocumenteerd (`docs/backup-recovery.md`) met RTO/RPO
- [x] API endpoints: `POST /admin/backup`, `GET /admin/backups`, `POST /admin/backup/restore`
- [x] Docker volume voor backups, mongodb-tools in container
- [x] Off-site backup: S3 en Azure Blob Storage support via optionele SDKs (`BACKUP_REMOTE_TYPE`)
- [x] Remote restore: download + restore vanuit S3/Azure via `POST /admin/backup/restore-remote`
- [x] Snapshot/restore getest met 150+ resources (50 patients, 100 observations) — data-integriteit geverifieerd

## 4. Compliance & certificering

- [x] NEN 7510 self-assessment (`docs/nen7510-self-assessment.md`) — 18 technische controls afgedekt
- [x] DPIA (`docs/dpia.md`) — risicobeoordeling met 10 risico's en maatregelen
- [x] AVG/GDPR verwerkersovereenkomst template (`docs/verwerkersovereenkomst-template.md`) — invullen per klant-relatie
- [x] Logging retentie: `AUDIT_RETENTION_DAYS` instellen op 1825 (5 jaar, NEN 7513) voor productie
- [x] WGBO bewaartermijnen: medische data heeft geen automatische verwijdering (20 jaar bewaard)

## 5. Operationeel

- [x] Runbook (`docs/runbook.md`): startup, shutdown, scaling, troubleshooting, logs, monitoring
- [x] Alerting: 3 Grafana alert rules (error rate >1%, p95 >500ms, MongoDB connections >80%)
- [x] Log aggregatie: Loki + Promtail in docker-compose, Grafana datasource auto-provisioned
- [x] MongoDB monitoring: percona/mongodb-exporter in docker-compose, Prometheus scrape target
- [x] Disaster recovery plan (`docs/disaster-recovery.md`): 5 scenario's met recovery procedures
