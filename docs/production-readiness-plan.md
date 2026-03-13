# Production Readiness Plan

> Status: **Development Server** — niet gevalideerd voor productiegebruik met patiëntdata.

## Huidige staat

De applicatie heeft een uitgebreide FHIR R4 implementatie met 170+ e2e tests. Onderstaande features zijn al gebouwd:

| Categorie | Status | Details |
|-----------|--------|---------|
| FHIR CRUD + Search | ✅ | Generiek voor alle resourcetypes, 8 search parameter types, chaining, _has |
| Validatie | ✅ | fhir-validator-mx met nl-core en Nictiz profielen |
| Batch/Transaction | ✅ | BundleProcessorService met urn:uuid resolution |
| $validate | ✅ | Type- en instance-level |
| $everything, $export | ✅ | Patient $everything, Bulk Data Export (NDJSON) |
| $bgz | ✅ | Basisgegevensset Zorg |
| Subscriptions | ✅ | REST-hook met criteria matching |
| SMART on FHIR | ✅ | JWT/JWKS validatie |
| Health checks | ✅ | /health met database connectivity, uptime, memory |
| Structured logging | ✅ | JSON logger, correlation IDs, audit middleware |
| Rate limiting | ✅ | Dual-window throttling met FHIR OperationOutcome |
| Database indexes | ✅ | 18+ compound indexes op fhir_resources |
| Security headers | ✅ | Helmet (CSP, HSTS), CORS, NoSQL injection bescherming |
| Docker | ✅ | Multi-stage build, docker-compose met MongoDB 7 |
| CI/CD | ✅ | GitHub Actions (lint, test, build, release-please) |

---

## Fase 1 — Infrastructuur (kritiek)

Minimaal nodig voordat de server betrouwbaar requests kan afhandelen in een omgeving met meerdere gebruikers.

### 1.1 Graceful shutdown

`main.ts` mist `app.enableShutdownHooks()`. Bij een restart/deploy worden lopende requests abrupt afgesloten.

- [x] `enableShutdownHooks()` aanroepen in bootstrap
- [x] `OnModuleDestroy` implementeren in services met open connections (SubscriptionNotificationService)
- [x] Testen met graceful shutdown (e2e test: in-flight requests completen, server stopt daarna)

**Bestanden:** `src/main.ts`, `src/fhir/subscriptions/subscription-notification.service.ts`

### 1.2 Prometheus metrics

Geen observability buiten logging. Productie vereist metrics voor dashboards en alerting.

- [x] `prom-client` + `@willsoto/nestjs-prometheus` toevoegen
- [x] Default metrics (request count, duration histogram, error rate via status label)
- [x] Custom metrics: search duration, validation duration, bundle entries, active subscriptions
- [x] `/metrics` endpoint (publieke route, geen auth vereist)
- [ ] Voorbeeld Grafana dashboard JSON meenemen in `docs/`

**Bestanden:** `src/metrics/metrics.module.ts`, `src/metrics/metrics.interceptor.ts`

### 1.3 MongoDB replica set

Transactions in `BundleProcessorService` vereisen een replica set. Zonder replica set is er geen atomiciteit bij transaction Bundles.

- [x] `docker-compose.yml` updaten naar single-node replica set (`--replSet rs0`)
- [x] Development: `MongoMemoryReplSet` gebruikt in e2e tests voor echte transactions
- [x] Connection string updaten met `replicaSet` parameter
- [x] `BundleProcessorService` gebruikt nu `session.withTransaction()` met fallback voor standalone
- [x] Transaction rollback getest: fout halverwege Bundle → alle entries gerollbackt (e2e test)

**Bestanden:** `docker-compose.yml`, `src/fhir/bundle-processor.service.ts`

### 1.4 Database connection pooling

Mongoose gebruikt standaard ~10 connecties. Voor productie moet dit configureerbaar zijn.

- [x] `MONGODB_POOL_SIZE` + `MONGODB_MIN_POOL_SIZE` env vars toegevoegd
- [x] Connection pool metrics exposen via Prometheus (`mongodb_pool_size`, `mongodb_pool_available`, `mongodb_pool_waiting`)
- [x] Gedocumenteerd in `.env.example`

**Bestanden:** `src/app.module.ts`, `.env.example`

---

## Fase 2 — Observability & betrouwbaarheid

### 2.1 OpenTelemetry tracing

Distributed tracing voor het opsporen van bottlenecks in zoekqueries, validatie en externe calls.

- [x] `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`
- [x] Auto-instrumentatie voor HTTP, Express en Mongoose
- [x] Export naar OTLP collector (Jaeger/Tempo) via `OTEL_EXPORTER_OTLP_ENDPOINT`
- [x] Trace ID doorgeven in response headers (`X-Trace-ID` via CorrelationMiddleware)
- [x] `OTEL_ENABLED` env var (default false)

**Bestanden:** `src/telemetry/telemetry.ts`, `src/main.ts`

### 2.2 Slow query logging

Queries die langer duren dan een drempel loggen met hun filter en execution stats.

- [x] MongoDB profiler level 1 (slow queries) configureren bij startup (`MONGODB_SLOW_QUERY_MS`, default 100ms)
- [x] In applicatie: queries > threshold loggen met filter en duration
- [x] Threshold configureerbaar via `SLOW_QUERY_THRESHOLD_MS` (default 500ms)

**Bestanden:** `src/fhir/fhir.service.ts`

### 2.3 Circuit breaker voor externe calls

Terminology server (Nictiz) en JWKS endpoints kunnen onbereikbaar zijn. Zonder circuit breaker blokkeren deze de hele applicatie.

- [x] `opossum` als circuit breaker library
- [x] `CircuitBreakerService` als globale factory met logging en status tracking
- [x] Toegepast op JWKS key fetching in SmartAuthGuard
- [x] Fallback: UnauthorizedException bij open circuit
- [x] Circuit state zichtbaar via `/health` endpoint

**Bestanden:** `src/resilience/circuit-breaker.service.ts`, `src/resilience/resilience.module.ts`, `src/fhir/guards/smart-auth.guard.ts`

### 2.4 Liveness vs readiness probes

Huidige `/health` combineert liveness en readiness. Kubernetes heeft aparte probes nodig.

- [x] `/health/live` — proces draait (altijd 200 tenzij crash)
- [x] `/health/ready` — database connected check
- [x] `/health` — uitgebreid met circuit breaker status
- [x] Docker-compose healthcheck gebruikt nu `/health/ready`

**Bestanden:** `src/health/health.controller.ts`, `docker-compose.yml`

---

## Fase 3 — Security & compliance

### 3.1 SMART scope enforcement per resource

SMART auth valideert tokens en dwingt scopes af op resourcetype-niveau.

- [x] Token scopes parsen (`patient/Patient.read`, `user/Observation.write`, etc.)
- [x] Guard checkt per request of de scope het resourcetype + operatie toestaat
- [x] `launch/patient` context: patient claim wordt als `smartPatientContext` aan request gehangen
- [x] Downstream filtering op patient-context in search queries (compartment filter + read access control)
- [x] Testen met restricted tokens (5 e2e tests: patient search, read, deny, observation filter, observation read)

**Bestanden:** `src/fhir/guards/smart-auth.guard.ts`, `src/fhir/smart/smart-scopes.ts`

### 3.2 Audit trail immutability

AuditEvent en Provenance resources zijn nu immutable (append-only).

- [x] AuditEvent en Provenance geblokkeerd voor update en delete operaties
- [x] `assertMutable()` check in `FhirService.update()` en `FhirService.delete()`
- [x] Audit log retentie beleid configureerbaar (TTL index via `AUDIT_RETENTION_DAYS`)

**Bestanden:** `src/fhir/fhir.service.ts`

### 3.3 Rate limiting per client

Rate limiting op basis van JWT client identity.

- [x] Rate limit key: JWT `client_id` > JWT `sub` > IP address
- [x] Health en metrics endpoints uitgesloten van rate limiting
- [x] Verschillende limieten per client/tier: delegeren aan reverse proxy/API gateway (Nginx, Kong, AWS API Gateway). Applicatie-level rate limiting is uniform per client identity.

**Bestanden:** `src/fhir/guards/fhir-throttler.guard.ts`

### 3.4 GDPR / AVG documentatie

Volledige procedure voor recht op verwijdering gedocumenteerd.

- [x] Stap-voor-stap procedure: $everything → cascade delete → $expunge
- [x] AuditEvent bewaarplicht (NEN 7513) en WGBO bewaartermijnen
- [x] Configuratie en verificatie stappen
- [x] Aanbeveling voor retentiebeleid

**Bestanden:** `docs/gdpr-procedure.md`

---

## Fase 4 — Performance & hardening

### 4.1 Load testing

k6 load test suite met seed script en 5 scenario's.

- [x] k6 test suite geschreven met seed data script
- [x] Scenario's: simple reads, search queries, CRUD mix, transaction/batch bundles, full mixed traffic
- [x] Thresholds gedefinieerd: p95 < 200ms reads, p95 < 500ms search, error rate < 1%
- [x] Baseline meten op development/staging omgeving
- [x] Bottlenecks identificeren en oplossen (_include/$in batching, parallel find+count, seed retry-logica, RATE_LIMIT_DISABLED env var)

**Bestanden:** `test/load/` directory

### 4.2 Caching layer

In-memory TTL cache voor conformance resources, CapabilityStatement en terminology operaties.

- [x] In-memory cache service met TTL (`CacheService`, `CacheModule`)
- [x] CapabilityStatement gecached in `FhirController.metadata()`
- [x] Conformance resource reads gecached in `AdministrationService.findById()`
- [x] Terminology lookups gecached ($expand, $lookup, $translate)
- [x] Cache invalidatie bij conformance resource create/update/delete
- [x] `CACHE_TTL_MS` configureerbaar (default 300000 = 5 min)
- [ ] Optioneel: Redis voor shared cache bij horizontaal schalen

**Bestanden:** `src/cache/cache.service.ts`, `src/cache/cache.module.ts`, `src/fhir/fhir.controller.ts`, `src/administration/administration.service.ts`, `src/administration/terminology/terminology.service.ts`

### 4.3 Request/response size limits

Limieten op request body size, Bundle entries en zoekresultaten om misbruik te voorkomen.

- [x] Max request body size configureerbaar via `BODY_SIZE_LIMIT` (default 5MB)
- [x] Max Bundle entries limiet via `MAX_BUNDLE_ENTRIES` (default 1000)
- [x] Max `_count` parameter begrensd via `MAX_COUNT` (default 1000)
- [x] Max include resultaten begrensd via `MAX_INCLUDE_RESULTS` (default 1000)

**Bestanden:** `src/main.ts`, `src/fhir/fhir.service.ts`, `src/fhir/bundle-processor.service.ts`, `src/fhir/search/include.service.ts`

### 4.4 Database optimalisatie

- [ ] Partial indexes voor soft-deleted resources (`{ _deleted: { $ne: true } }`)
- [x] TTL index op AuditEvent resources (configureerbaar via `AUDIT_RETENTION_DAYS`, default 365)
- [ ] Index usage analyseren met `db.collection.aggregate([{$indexStats}])`
- [ ] Overweeg sharding strategie voor > 10M resources

**Bestanden:** `src/fhir/fhir-resource.schema.ts`

---

## Fase 5 — Platform features (optioneel)

Deze features zijn niet nodig voor single-tenant productie maar wel voor een platform.

### 5.1 Multi-tenancy

Bestaand plan in `docs/multi-tenancy-plan.md`. URL-based routing + database-per-tenant.

### 5.2 Consent enforcement

Consent resources opslaan en afdwingen bij data access op basis van purpose-of-use en actor.

### 5.3 GraphQL API

Bestaand plan in `docs/graphql-plan.md`.

### 5.4 Async job queue

Bulk export en $reindex draaien nu in-process. Voor grote datasets is een job queue nodig (Bull/BullMQ met Redis).

---

## Prioritering

| Prioriteit | Items | Geschatte effort |
|------------|-------|-----------------|
| **P0 — Blokkerend** | 1.1 graceful shutdown, 1.3 replica set | 1 dag |
| **P1 — Kritiek** | 1.2 metrics, 2.4 probes, 3.1 scope enforcement, 4.3 size limits | 2-3 dagen |
| **P2 — Belangrijk** | 1.4 pooling, 2.1 tracing, 2.3 circuit breaker, 3.2 audit immutability, 4.1 load testing | 3-4 dagen |
| **P3 — Wenselijk** | 2.2 slow queries, 3.3 per-client rate limit, 3.4 GDPR docs, 4.2 caching, 4.4 DB optimalisatie | 2-3 dagen |
| **P4 — Platform** | 5.1-5.4 multi-tenancy, consent, GraphQL, job queue | weken |

**Totaal voor productie-waardig (P0-P2): ~1-2 weken**
