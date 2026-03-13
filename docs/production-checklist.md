# Production Checklist

Resterende stappen voordat de disclaimer "niet gevalideerd voor productiegebruik met patiëntdata" verwijderd kan worden.

## 1. Security validatie

- [ ] Penetration test (extern) — OWASP Top 10, FHIR-specifieke aanvallen
- [ ] Dependency audit: `npm audit` clean op productie dependencies
- [ ] TLS termination configureren op reverse proxy (Nginx/Traefik)
- [ ] SMART on FHIR configureren met echte authorization server (Keycloak/Auth0)
- [ ] Review van alle env vars: geen secrets in defaults of docker-compose

## 2. Load test op productie-hardware

- [ ] Dataset: 100K+ resources (realistische mix Patient/Observation/Encounter)
- [ ] Load test draaien op target hardware/cloud instance
- [ ] Thresholds valideren: p95 < 200ms reads, p95 < 500ms search, < 1% errors
- [ ] MongoDB connection pool tunen op basis van resultaten
- [ ] Memory profiling: geen leaks na 24h sustained load

## 3. Backup & recovery

- [x] Geautomatiseerde MongoDB backup pipeline (BackupService met scheduled mongodump, retention)
- [x] Recovery procedure gedocumenteerd (`docs/backup-recovery.md`) met RTO/RPO
- [x] API endpoints: `POST /admin/backup`, `GET /admin/backups`, `POST /admin/backup/restore`
- [x] Docker volume voor backups, mongodb-tools in container
- [ ] Snapshot/restore testen met productie-volume data
- [ ] Externe opslag configureren (S3/Azure Blob) voor off-site backups

## 4. Compliance & certificering

- [ ] NEN 7510 audit (informatiebeveiliging in de zorg)
- [ ] DPIA (Data Protection Impact Assessment) uitvoeren
- [ ] AVG/GDPR verwerkersovereenkomst opstellen
- [ ] Logging retentie afstemmen op NEN 7513 (minimaal 5 jaar voor medische logging)
- [ ] WGBO bewaartermijnen valideren (20 jaar voor medische dossiers)

## 5. Operationeel

- [ ] Runbook schrijven: startup, shutdown, scaling, troubleshooting
- [ ] Alerting configureren in Grafana (error rate > 1%, p95 > 500ms, disk > 80%)
- [ ] Log aggregatie opzetten (ELK/Loki) voor centraal logbeheer
- [ ] MongoDB monitoring (Atlas of eigen Prometheus exporter)
- [ ] Disaster recovery plan: wat als MongoDB corrupt raakt, wat als de server crasht
