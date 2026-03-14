# Roadmap

Laatste update: 2026-03-14

## Status

Het project is technisch productie-klaar (fase 1-4 van het production readiness plan afgerond). Alle CodeQL en Dependabot alerts zijn opgelost. Load tests laten zien dat de API ruim binnen targets presteert (p95 reads <11ms, searches <44ms, writes <30ms, 0% errors).

---

## Fase 6 — Hardening & CI

Geschatte inspanning: klein. Geen nieuwe features, puur betrouwbaarheid.

### 6.1 E2e tests in CI pipeline
- [x] MongoDB Memory Server gebruikt in alle e2e tests (automatische download)
- [x] Alle 16 e2e test suites draaien via `npm run test:e2e` in CI
- [x] Node 22 in CI pipeline

### 6.2 Docker health checks
- [x] `HEALTHCHECK` instructie in Dockerfile (`wget /health/live`)
- [x] `healthcheck` config in docker-compose: fhir-api, mongo, prometheus, jaeger, grafana
- [x] `depends_on.condition: service_healthy` voor startup ordering
- Note: Loki en otel-collector zijn scratch images zonder shell/tools — geen healthcheck mogelijk

### 6.3 npm audit clean
- [x] Prod dependencies: 0 vulnerabilities
- [x] Dev dependencies: 6 moderate (ajv ReDoS via @nestjs/cli → @angular-devkit) — upstream issue, niet in productie

---

## Fase 7 — FHIR Operations

Geschatte inspanning: middel. Verrijkt de FHIR-conformiteit.

### 7.1 $validate operation
- [x] POST `[type]/$validate` en `[type]/[id]/$validate` endpoints
- [x] FhirValidationService met fhir-validator-mx library
- [x] Conformance resources uit MongoDB (823 profiles, 1393 value sets, 1064 code systems)
- [x] FhirValidationPipe voor automatische validatie bij create/update
- [x] OperationOutcome response met issues per veld

### 7.2 Subscriptions (R4)
- [x] Subscription resource CRUD via generieke FHIR endpoints
- [x] Channel type: `rest-hook` (webhook) met custom headers
- [x] Trigger op create/update/delete via EventEmitter (`fhir.resource.changed`)
- [x] Retry met exponential backoff (3 retries, 1s base delay)
- [x] Status tracking (requested → active → error)
- [x] Graceful shutdown (in-flight delivery tracking)
- [x] E2e tests (`test/subscription.e2e-spec.ts`)

### 7.3 $member-match (Da Vinci)
- [x] POST `Patient/$member-match` endpoint
- [x] Input: Parameters met MemberPatient, OldCoverage, NewCoverage
- [x] Match op BSN/identifier, naam, geboortedatum, geslacht
- [x] 422 bij geen match of meerdere matches
- [x] E2e tests (5 tests: BSN match, demographics match, no match, missing params)

---

## Fase 8 — Multi-tenancy & Schaalbaarheid

### 8.1 Tenant isolation ✅
- [x] Configureerbare multi-tenancy via `config/app-config.json` (`tenant.enabled`)
- [x] Database-per-tenant isolatie (elke tenant eigen database met eigen indexes)
- [x] URL-based routing: `/t/:tenantId/fhir/...` met URL-rewriting middleware
- [x] Header-based routing: `X-Tenant-Id` header op `/fhir/...` routes
- [x] Guard: FHIR routes vereisen tenant identifier wanneer multi-tenancy aan staat
- [x] Tenant admin API: `GET/POST/DELETE /admin/tenants`, suspend/activate lifecycle
- [x] Tenant-aware model injection via REQUEST-scoped providers (alle FHIR services)
- [x] `getBaseUrl()` tenant-prefix in bundle links en Location headers
- [x] `tenantId` in audit- en correlatie-logs
- [x] Idle connection cleanup (15 min) + graceful shutdown
- [x] NoSQL injection bescherming op tenant queries
- [x] 22 e2e tests (admin CRUD, data isolatie, base URL, lifecycle)

### 8.2 Horizontale schaalbaarheid ✅
- [x] Redis als gedeelde cache (vervangt in-memory TTL cache)
- [x] Redis-backed rate limiting via `@nest-lab/throttler-storage-redis`
- [x] Dual-mode cache: instelbaar via `cache.store` (`"redis"` of `"memory"`)
- [x] Automatische fallback naar in-memory bij Redis connection failure
- [x] Redis service in docker-compose met healthcheck
- [x] Gecentraliseerde configuratie via `config/app-config.json`

### 8.3 Stateless & tenant features ✅
- [x] Stateless bulk export: polling-based job queue, GridFS NDJSON opslag, heartbeat, cursor streaming
- [x] Tenant-specifieke conformance resources: auto-seed bij provisioning vanuit master database
- [x] Tenant-scoped rate limiting: per-tenant buckets + config overrides (Redis/in-memory)

---

## Fase 9 — Extern & Compliance

Geschatte inspanning: afhankelijk van budget en beschikbaarheid derden.

### 9.1 Authorization server
- [ ] Keycloak of Auth0 configureren als SMART authorization server
- [ ] Token introspection of JWKS endpoint koppelen
- [ ] PKCE flow voor publieke clients

### 9.2 Penetration test
- [ ] Externe pentest door gecertificeerde partij
- [ ] OWASP top 10 + FHIR-specifieke aanvalsvectoren
- [ ] Remediation van bevindingen

### 9.3 NEN 7510 certificering
- [ ] Externe audit op basis van bestaande self-assessment
- [ ] Gap analysis en remediation
- [ ] Formele certificering

### 9.4 24-uurs soak test
- [ ] k6 soak test op productie-hardware (niet Docker Desktop)
- [ ] Memory leak detectie, connection pool stabiliteit
- [ ] Monitoring dashboards valideren onder langdurige load

---

## Prioritering

| Fase | Prioriteit | Reden |
|------|-----------|-------|
| 6 — Hardening & CI | ~~Hoog~~ Voltooid | CI, healthchecks, audit |
| 7 — FHIR Operations | ~~Middel~~ Voltooid | $validate, Subscriptions, $member-match |
| 8.1 — Tenant isolation | ~~Laag~~ Voltooid | Database-per-tenant, admin API, 22 e2e tests |
| 8.2 — Schaalbaarheid | ~~Laag~~ Voltooid | Redis cache + rate limiting |
| 8.3 — Stateless & tenant features | ~~Laag~~ Voltooid | Stateless bulk export, tenant rate limiting, conformance seeding |
| 9 — Extern | Laag | Budget-afhankelijk |
