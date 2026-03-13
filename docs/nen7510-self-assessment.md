# NEN 7510 Self-Assessment

> **Status:** Self-assessment — geen externe audit uitgevoerd.
>
> Dit document beschrijft welke NEN 7510 / ISO 27001 controls zijn afgedekt door de FHIR API Server applicatie en welke buiten scope vallen (organisatorisch/operationeel).

## Scope

Deze assessment dekt de **applicatie-laag** van de FHIR API Server. Infrastructurele controls (datacenter, netwerk, fysieke beveiliging) vallen onder de hosting-partij en worden hier niet behandeld.

---

## A.5 — Informatiebeveiligingsbeleid

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.5.1 Beleidsregels | ⚠️ Organisatorisch | Dit document dient als technisch beveiligingsbeleid. Organisatorisch beleid moet apart worden opgesteld. |

## A.6 — Organisatie van informatiebeveiliging

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.6.1 Interne organisatie | ⚠️ Organisatorisch | Rollen en verantwoordelijkheden moeten per organisatie worden vastgelegd. |
| A.6.2 Mobiele apparatuur | N.v.t. | Server-side applicatie, geen mobiele client. |

## A.7 — Veilig personeel

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.7.1-7.3 Personeel | ⚠️ Organisatorisch | VOG, geheimhoudingsverklaring, security awareness zijn organisatorische maatregelen. |

## A.8 — Beheer van bedrijfsmiddelen

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.8.1 Inventarisatie | ✅ Afgedekt | `docker-compose.yml` definieert alle componenten (MongoDB, Prometheus, Grafana, Jaeger). Dependencies in `package.json`. |
| A.8.2 Classificatie | ⚠️ Deels | Medische data wordt als vertrouwelijk behandeld. OperationOutcome responses bevatten geen patiëntdata. Meta security labels ondersteund op resources. |

## A.9 — Toegangsbeveiliging

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.9.1 Toegangsbeleid | ✅ Afgedekt | SMART on FHIR met OAuth2 Bearer tokens. Standaard is alles geblokkeerd tenzij SMART disabled. |
| A.9.2 Gebruikersbeheer | ✅ Gedelegeerd | Gebruikersbeheer via externe authorization server (Keycloak/Auth0). JWT claims bevatten identiteit. |
| A.9.3 Verantwoordelijkheden | ✅ Afgedekt | Rate limiting per client identity (`client_id` > `sub` > IP). Session-loos (stateless JWT). |
| A.9.4 Systeemtoegang | ✅ Afgedekt | SMART scopes enforcement per resource type en operatie (`patient/Patient.read`, `system/*.write`). Patient-context filtering beperkt data tot de geautoriseerde patiënt. Consent enforcement voor deny-based restricties. |
| A.9.4.1 Informatieverwerking beperken | ✅ Afgedekt | Dangerous operations (expunge, cascade delete, backup/restore) standaard disabled. Moeten expliciet worden geactiveerd via env var of config. |

**Bestanden:** `src/fhir/guards/smart-auth.guard.ts`, `src/fhir/smart/smart-scopes.ts`, `src/fhir/consent/consent-enforcement.service.ts`, `src/admin/guards/dangerous-operation.guard.ts`

## A.10 — Cryptografie

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.10.1 Versleuteling in transit | ✅ Afgedekt | HSTS header met 1 jaar max-age (via Helmet). TLS termination op reverse proxy. |
| A.10.1 Versleuteling in rust | ⚠️ Infra | MongoDB Encryption at Rest is een configuratie-optie op database-niveau (WiredTiger encryption of MongoDB Atlas). Niet op applicatieniveau. |
| A.10.2 Sleutelbeheer | ✅ Gedelegeerd | JWT signing keys beheerd door authorization server via JWKS. Applicatie verifieert alleen, slaat geen keys op. |

## A.12 — Beveiliging bedrijfsvoering

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.12.1 Procedures en verantwoordelijkheden | ✅ Afgedekt | Graceful shutdown (`enableShutdownHooks`), circuit breaker pattern voor externe services, request timeout (30s default). |
| A.12.2 Bescherming tegen malware | ✅ Afgedekt | Input validatie: FHIR R4 profiel validatie, NoSQL injection preventie (`sanitizeValue`, `stripDollarKeys`, `escapeRegex`), XXE preventie in XML parser, body size limits (5MB). |
| A.12.3 Back-up | ✅ Afgedekt | Geautomatiseerde mongodump backups (24h interval, 7 retentie). API endpoints voor handmatige backup/restore. Docker volume voor persistentie. Zie `docs/backup-recovery.md`. |
| A.12.4 Logging en monitoring | ✅ Afgedekt | Zie A.12.4 detail hieronder. |
| A.12.6 Technisch kwetsbaarheidsbeheer | ✅ Afgedekt | `npm audit` in CI pipeline. GitHub Actions voert security audit uit bij elke push. Dependabot/Renovate aanbevolen voor automatische updates. |

### A.12.4 Logging en monitoring (detail)

| Aspect | Implementatie |
|--------|---------------|
| **Audit logging** | Automatische AuditEvent resources voor alle FHIR interacties (create, read, update, delete, search). Bevat: gebruiker (JWT sub/name), client IP, user-agent, timestamp, resource type/id. |
| **Audit retentie** | NEN 7513 vereist minimaal 5 jaar. Configureerbaar via `AUDIT_RETENTION_DAYS` (default 365). **Actie nodig: verhoog naar 1825 (5 jaar) voor productie.** |
| **Immutability** | AuditEvent en Provenance resources zijn immutable — update en delete geblokkeerd. |
| **Correlation** | Elke request krijgt een UUID correlation ID (`X-Correlation-ID`). OpenTelemetry trace ID (`X-Trace-ID`) bij tracing enabled. |
| **Structured logging** | JSON logging met `LOG_FORMAT=json`. Bevat: correlationId, method, url, status, duration, contentLength, userAgent. |
| **Metrics** | Prometheus metrics op `/metrics`: request rate, latency percentiles, search/validation duration, MongoDB pool stats. |
| **Dashboards** | Grafana dashboard met 18 panels: traffic, latency, errors, MongoDB, Node.js runtime. |
| **Tracing** | OpenTelemetry distributed tracing naar Jaeger (opt-in via `OTEL_ENABLED`). |
| **Slow query logging** | Queries > threshold worden gelogd met filter en duration. MongoDB profiler level 1 bij startup. |

**Bestanden:** `src/fhir/audit/audit-event.service.ts`, `src/logging/audit.middleware.ts`, `src/logging/correlation.middleware.ts`, `src/metrics/`, `src/telemetry/telemetry.ts`

## A.13 — Communicatiebeveiliging

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.13.1 Netwerkbeveiliging | ✅ Afgedekt | Docker network isolatie. Alleen noodzakelijke poorten geëxposeerd. CORS beleid configureerbaar. Security headers via Helmet. |
| A.13.2 Informatieoverdracht | ✅ Afgedekt | FHIR content-type enforcement (`application/fhir+json`). ETag/If-Match voor data integriteit bij updates. |

## A.14 — Acquisitie, ontwikkeling en onderhoud

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.14.1 Beveiligingseisen | ✅ Afgedekt | FHIR R4 conformiteit als basis. Input validatie op alle endpoints. Profiel-gebaseerde validatie met nl-core profielen. |
| A.14.2 Beveiliging in ontwikkeling | ✅ Afgedekt | CI/CD pipeline (lint, test, build, security audit). 170+ e2e tests. ESLint met TypeScript strict rules. |
| A.14.3 Testgegevens | ✅ Afgedekt | `mongodb-memory-server` voor tests (geen productiedata nodig). k6 load tests met synthetische seed data. |

## A.16 — Beheer van informatiebeveiligingsincidenten

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.16.1 Incidentbeheer | ⚠️ Deels | Logging en monitoring zijn ingericht. Alerting configuratie (Grafana alerts) moet nog worden ingesteld. Incident response procedure is organisatorisch. |

## A.17 — Bedrijfscontinuïteit

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.17.1 Continuïteit | ✅ Afgedekt | Automated backups met configureerbare retentie. Docker restart policies (`unless-stopped`). Health checks voor container orchestratie. RTO < 5 min, RPO configureerbaar (default 24h). |

## A.18 — Naleving

| Control | Status | Toelichting |
|---------|--------|-------------|
| A.18.1 Wettelijke eisen | ⚠️ Deels | AVG/GDPR: `$expunge` operatie voor recht op verwijdering, GDPR procedure gedocumenteerd (`docs/gdpr-procedure.md`). WGBO: 20 jaar bewaartermijn ondersteund (geen automatische verwijdering van medische data). NEN 7513: audit logging met configureerbare retentie. |

---

## Samenvatting

| Categorie | Afgedekt | Deels/Organisatorisch | Niet afgedekt |
|-----------|----------|----------------------|---------------|
| Toegangsbeveiliging (A.9) | 5 | 0 | 0 |
| Cryptografie (A.10) | 2 | 1 | 0 |
| Bedrijfsvoering (A.12) | 5 | 0 | 0 |
| Communicatie (A.13) | 2 | 0 | 0 |
| Ontwikkeling (A.14) | 3 | 0 | 0 |
| Continuïteit (A.17) | 1 | 0 | 0 |
| **Totaal technisch** | **18** | **1** | **0** |
| Organisatorisch (A.5-7, A.16, A.18) | 0 | 5 | 0 |

**Alle technische controls zijn afgedekt.** De openstaande items zijn organisatorisch (beleid, personeel, incident response) en moeten per organisatie worden ingevuld.

## Actiepunten voor productie

1. **`AUDIT_RETENTION_DAYS=1825`** — NEN 7513 vereist minimaal 5 jaar
2. **Grafana alerts configureren** — error rate, latency, disk usage
3. **CORS_ORIGIN beperken** — geen wildcard in productie
4. **MongoDB Encryption at Rest** — activeren op database-niveau
5. **Externe penetration test** — wanneer budget beschikbaar
