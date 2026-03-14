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
- [ ] POST `[type]/$validate` — valideer resource tegen StructureDefinition
- [ ] Gebruik bestaande conformance_resources collectie voor StructureDefinitions
- [ ] OperationOutcome response met issues per veld
- [ ] Integratie in create/update flows (optioneel, via config)

### 7.2 Subscriptions (R4)
- [ ] Subscription resource CRUD
- [ ] Channel types: `rest-hook` (webhook)
- [ ] Trigger op resource create/update/delete via bestaande EventEmitter
- [ ] Retry met exponential backoff bij delivery failure
- [ ] Status tracking (requested → active → error → off)

### 7.3 $member-match (Da Vinci)
- [ ] Patient matching operation voor zorgverzekeraar-overgang
- [ ] Input: oude coverage + nieuwe coverage + patient demographics
- [ ] Match op BSN/identifier, naam, geboortedatum

---

## Fase 8 — Multi-tenancy & Schaalbaarheid

Geschatte inspanning: groot. Alleen als er meerdere afnemers komen.

### 8.1 Tenant isolation
- [ ] Tenant ID in JWT claims
- [ ] Database-level of collection-level isolation (zie `docs/multi-tenancy-plan.md`)
- [ ] Tenant-scoped rate limiting
- [ ] Tenant-specifieke conformance resources

### 8.2 Horizontale schaalbaarheid
- [ ] Redis voor gedeelde cache (vervangt in-memory TTL cache)
- [ ] Redis-backed rate limiting (cross-instance)
- [ ] Sticky sessions of stateless design voor bulk export

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
| 6 — Hardening & CI | Hoog | Laag risico, direct waardevol, geen externe afhankelijkheden |
| 7.1 — $validate | Hoog | Core FHIR conformiteit, voorkomt corrupte data |
| 7.2 — Subscriptions | Middel | Event-driven integratie, architectuur staat er klaar voor |
| 7.3 — $member-match | Laag | Alleen relevant voor verzekeraar use case |
| 8 — Multi-tenancy | Laag | Pas bij meerdere afnemers |
| 9 — Extern | Laag | Budget-afhankelijk |
