# Feature Vergelijking met FHIR Server Concurrenten

Vergelijking van onze FHIR API server met Firely Server, HAPI FHIR, IBM LinuxForHealth, Google Cloud Healthcare API en Microsoft Azure FHIR Server.

## Wat we al hebben

| Feature | Status |
|---------|--------|
| CRUD (create, read, update, delete) | ✅ |
| Search: alle parameter types (string, token, date, reference, number, quantity, uri, composite) | ✅ |
| Geavanceerde search: _include/_revinclude, _summary/_elements, chaining, _has, _text/_content | ✅ |
| POST _search, paginatie met next/previous links | ✅ |
| $validate (type- en instance-level) | ✅ |
| CapabilityStatement met dynamische search parameters | ✅ |
| $meta, $meta-add, $meta-delete | ✅ |
| FHIR validatie met nl-core profielen (fhir-validator-mx) | ✅ |
| Versie-historie: vRead, instance/type/system _history, soft deletes | ✅ |
| Conditional CRUD: If-None-Exist, If-Match, conditional update/delete | ✅ |
| Batch/Transaction Bundle met urn:uuid referentie-resolutie | ✅ |
| FHIR R4 Subscriptions (rest-hook) | ✅ |
| SMART on FHIR / OAuth2 | ✅ |
| Bulk Data Export ($export) — async NDJSON | ✅ |
| $everything (Patient) | ✅ |
| $bgz (Basisgegevensset Zorg) | ✅ |
| AuditEvent generatie (read, search, create, update, delete) | ✅ |
| Administration API (Firely-style) voor conformance resources | ✅ |
| Rate limiting, NoSQL injection bescherming | ✅ |
| Docker, health checks, structured logging, CI/CD | ✅ |
| Swagger/OpenAPI + Insomnia collectie | ✅ |
| PATCH: JSON Patch (RFC 6902) + FHIRPath Patch (Parameters) | ✅ |
| Compartment Search (Patient, Practitioner, Encounter) | ✅ |
| CORS configuratie voor browser-based SMART apps | ✅ |
| Terminology Services: $expand, $lookup, $translate | ✅ |

## Ontbrekende features

### Hoge prioriteit — alle 5 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| ~~1~~ | ~~**PATCH**~~ | | | | | | ~~Geïmplementeerd: JSON Patch + FHIRPath Patch~~ |
| ~~2~~ | ~~**Compartment Search**~~ | | | | | | ~~Geïmplementeerd: Patient, Practitioner, Encounter compartments~~ |
| ~~3~~ | ~~**Terminology Services**~~ | | | | | | ~~Geïmplementeerd: $expand, $lookup, $translate~~ |
| 4 | **XML Format** | ✅ | ✅ | ✅ | ✅ | ✅ | `application/fhir+xml` + content negotiation via `Accept` header en `_format` parameter. FHIR spec beveelt beide formats sterk aan. |
| 5 | **Binary Resource** | ✅ | ✅ | ✅ | ✅ | ✅ | Speciale content-type handling: FHIR JSON bij `Accept: application/fhir+json`, ruwe content bij eigen MIME type. |
| 6 | **Referential Integrity** | — | ✅ | ✅ | ✅ | ✅ | Voorkom verwijzingen naar niet-bestaande resources. Blokkeer delete als resource nog gerefereerd wordt. |

### Medium prioriteit — 3-4 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| 7 | **$lastn** | — | ✅ | — | ✅ | ✅ | Laatste N observaties per code — essentieel voor vitals/labs ("geef me de laatste 3 bloeddrukmetingen"). |
| 8 | **Custom SearchParameters** | ✅ | ✅ | ✅ | — | ✅ | Runtime-defined search parameters via SearchParameter resources + reindexering van bestaande data. |
| 9 | **Cascading Deletes** | ✅ | ✅ | — | — | ✅ | `_cascade=delete` parameter: verwijder automatisch afhankelijke resources mee. |
| ~~10~~ | ~~**CORS**~~ | | | | | | ~~Geïmplementeerd: configureerbaar via CORS_ORIGIN env var~~ |
| 11 | **GraphQL** | ✅ | ✅ | — | ✅ | — | Alternatieve query interface per FHIR spec. Client vraagt precies de velden op die nodig zijn. |
| 12 | **Multi-tenancy** | — | ✅ | ✅ | — | — | Meerdere geïsoleerde tenants op één server-instantie met gescheiden datapools. |

### Lagere prioriteit — 2-3 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| 13 | **$expunge** | — | ✅ | ✅ | — | — | Hard delete / fysieke purge. Belangrijk voor AVG/GDPR compliance. |
| 14 | **$reindex** | — | ✅ | ✅ | — | ✅ | Herindexering na SearchParameter wijzigingen of schema-updates. |
| ~~15~~ | ~~**$translate**~~ | | | | | | ~~Geïmplementeerd als onderdeel van Terminology Services~~ |
| 16 | **Consent-based Access** | ✅ | ✅ | — | — | — | Toegangscontrole op basis van FHIR Consent resources. Gaat verder dan OAuth scopes. |
| 17 | **UCUM Unit Conversion** | ✅ | ✅ | — | — | — | Automatische eenheidsconversie bij quantity search (bijv. "1 kg" matcht ook "1000 g"). |
| 18 | **$convert** | ✅ | ✅ | — | — | — | Conversie tussen FHIR versies (STU3 ↔ R4). Nuttig in mixed-version omgevingen. |
| 19 | **$diff** | — | ✅ | — | — | — | Vergelijk twee versies van een resource of twee resources onderling. |

## Aanbevolen implementatievolgorde

### ~~Fase 1 — Core FHIR conformiteit~~ ✅ DONE
~~1. **PATCH** — core interactie, universeel verwacht door clients~~
~~2. **Compartment Search** — fundamenteel concept, relatief eenvoudig te bouwen~~
~~3. **CORS** — noodzakelijk voor browser-based SMART apps~~

### ~~Fase 2 — Klinische waarde~~ (deels afgerond)
~~4. **Terminology Services** ($expand, $lookup, $translate) — kritiek voor validatie workflows~~
5. **$lastn** — hoge klinische waarde, veel gevraagd door clients
6. **Referential Integrity** — data kwaliteit en consistentie

### Fase 3 — Uitbreidingen
7. **Binary Resource** handling
8. **XML Format** support
9. **Custom SearchParameters** + $reindex
10. **Cascading Deletes**

### Fase 4 — Geavanceerd
11. **$expunge** (GDPR)
12. **GraphQL**
13. **Multi-tenancy**
14. **Consent-based Access Control**