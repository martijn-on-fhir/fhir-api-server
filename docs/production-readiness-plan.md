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
- [ ] Testen met `kill -SIGTERM` tijdens actieve requests

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
- [ ] Development: `mongodb-memory-server` ondersteunt replica set al (optie `replSet`)
- [x] Connection string updaten met `replicaSet` parameter
- [x] `BundleProcessorService` gebruikt nu `session.withTransaction()` met fallback voor standalone
- [ ] Transaction rollback testen bij fout halverwege een Bundle

**Bestanden:** `docker-compose.yml`, `src/fhir/bundle-processor.service.ts`

### 1.4 Database connection pooling

Mongoose gebruikt standaard ~10 connecties. Voor productie moet dit configureerbaar zijn.

- [x] `MONGODB_POOL_SIZE` + `MONGODB_MIN_POOL_SIZE` env vars toegevoegd
- [ ] Connection pool metrics exposen via Prometheus
- [x] Gedocumenteerd in `.env.example`

**Bestanden:** `src/app.module.ts`, `.env.example`

---

## Fase 2 — Observability & betrouwbaarheid

### 2.1 OpenTelemetry tracing

Distributed tracing voor het opsporen van bottlenecks in zoekqueries, validatie en externe calls.

- [ ] `@opentelemetry/sdk-node` + `@opentelemetry/auto-instrumentations-node`
- [ ] Spans voor: search query building, MongoDB queries, validation, subscription webhooks
- [ ] Export naar OTLP collector (Jaeger/Tempo)
- [ ] Trace ID doorgeven in response headers
- [ ] `OTEL_ENABLED` env var (default false)

**Bestanden:** nieuw `src/telemetry/` module

### 2.2 Slow query logging

Queries die langer duren dan een drempel loggen met hun filter en execution stats.

- [ ] MongoDB profiler level 1 (slow queries) configureren
- [ ] In applicatie: queries > 500ms loggen met filter en duration
- [ ] Threshold configureerbaar via `SLOW_QUERY_THRESHOLD_MS`

**Bestanden:** `src/fhir/fhir.service.ts`

### 2.3 Circuit breaker voor externe calls

Terminology server (Nictiz) en JWKS endpoints kunnen onbereikbaar zijn. Zonder circuit breaker blokkeren deze de hele applicatie.

- [ ] `opossum` of `cockatiel` als circuit breaker library
- [ ] Toepassen op: terminology server calls, JWKS fetches, subscription webhook delivery
- [ ] Fallback: cached response of graceful degradation
- [ ] Circuit state exposen via health endpoint en metrics

**Bestanden:** `src/fhir/validation/`, `src/fhir/smart/`, `src/fhir/subscriptions/`

### 2.4 Liveness vs readiness probes

Huidige `/health` combineert liveness en readiness. Kubernetes heeft aparte probes nodig.

- [ ] `/health/live` — proces draait (altijd 200 tenzij crash)
- [ ] `/health/ready` — database connected, validator geladen, indexes klaar
- [ ] Docker-compose en K8s manifests updaten

**Bestanden:** `src/health/health.controller.ts`

---

## Fase 3 — Security & compliance

### 3.1 SMART scope enforcement per resource

SMART auth valideert tokens maar dwingt scopes niet af op resourcetype-niveau.

- [ ] Token scopes parsen (`patient/Patient.read`, `user/Observation.write`, etc.)
- [ ] Guard die per request checkt of de scope het resourcetype + operatie toestaat
- [ ] `launch/patient` context scope voor patient-gebonden toegang
- [ ] Testen met restricted tokens

**Bestanden:** `src/fhir/guards/smart-auth.guard.ts`

### 3.2 Audit trail immutability

AuditEvents worden als reguliere FHIR resources opgeslagen en kunnen gewijzigd/verwijderd worden.

- [ ] AuditEvent en Provenance uitsluiten van update/delete operaties
- [ ] Of: apart audit log schrijven naar append-only store (bijv. apart MongoDB collection met `validator: { $jsonSchema }` die updates blokkeert)
- [ ] Audit log retentie beleid configureerbaar

**Bestanden:** `src/fhir/audit/audit-event.service.ts`, `src/fhir/fhir.service.ts`

### 3.3 Rate limiting per client

Huidige rate limiting is globaal (per IP). Productie vereist per-client limiting op basis van SMART token.

- [ ] Rate limit key extraheren uit JWT `client_id` of `sub` claim
- [ ] Verschillende limieten per client/tier configureerbaar
- [ ] Rate limit headers (`X-RateLimit-Remaining`, `Retry-After`)

**Bestanden:** `src/fhir/guards/fhir-throttler.guard.ts`

### 3.4 GDPR / AVG documentatie

$expunge bestaat maar het volledige proces voor recht op verwijdering is niet gedocumenteerd.

- [ ] Procedure documenteren: welke resources verwijderen bij een wis-verzoek
- [ ] $expunge + cascade delete combinatie voor volledige data wissing
- [ ] AuditEvent bewaren (wettelijke bewaarplicht) maar patiëntdata anonimiseren
- [ ] Retentiebeleid per resourcetype configureerbaar

**Bestanden:** `docs/gdpr-procedure.md`

---

## Fase 4 — Performance & hardening

### 4.1 Load testing

Geen performance baseline. Onbekend hoe de server zich gedraagt onder load.

- [ ] k6 of Artillery test suite schrijven
- [ ] Scenario's: CRUD mix, zware zoekqueries, bulk export, concurrent transactions
- [ ] Baseline meten: throughput (req/s), p50/p95/p99 latency, error rate
- [ ] Bottlenecks identificeren en oplossen
- [ ] Target: 500 req/s bij p95 < 200ms voor eenvoudige reads

**Bestanden:** nieuw `test/load/` directory

### 4.2 Caching layer

Conformance resources en veelgebruikte zoekresultaten worden elke keer uit MongoDB geladen.

- [ ] In-memory cache voor CapabilityStatement, SearchParameter, StructureDefinition
- [ ] Cache invalidatie bij conformance resource wijzigingen
- [ ] Optioneel: Redis voor shared cache bij horizontaal schalen
- [ ] `CACHE_TTL` configureerbaar (default 5 min)

**Bestanden:** `src/fhir/administration/`

### 4.3 Request/response size limits

Geen limiet op request body size of Bundle entries. Kan misbruikt worden.

- [ ] Max request body size configureerbaar (default 10MB)
- [ ] Max Bundle entries limiet (default 1000)
- [ ] Max `_count` parameter begrenzen (default max 1000)
- [ ] Max include depth begrenzen

**Bestanden:** `src/main.ts`, `src/fhir/fhir.controller.ts`

### 4.4 Database optimalisatie

- [ ] Partial indexes voor soft-deleted resources (`{ _deleted: { $ne: true } }`)
- [ ] TTL index op AuditEvent resources (configureerbare retentie)
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
