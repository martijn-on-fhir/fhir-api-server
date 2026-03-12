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
| $lastn (Observation) — laatste N per code | ✅ |
| Referential Integrity — blokkeer delete bij referenties | ✅ |
| XML Format — content negotiation via Accept header en `_format` parameter | ✅ |
| Binary Resource — raw content negotiation + FHIR JSON/XML | ✅ |
| Custom SearchParameters + $reindex operatie | ✅ |
| Cascading Deletes (`_cascade=delete`) | ✅ |
| $expunge — hard delete / fysieke purge (GDPR/AVG compliance) | ✅ |

## Ontbrekende features

### Hoge prioriteit — alle 5 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| ~~1~~ | ~~**PATCH**~~ | | | | | | ~~Geïmplementeerd: JSON Patch + FHIRPath Patch~~ |
| ~~2~~ | ~~**Compartment Search**~~ | | | | | | ~~Geïmplementeerd: Patient, Practitioner, Encounter compartments~~ |
| ~~3~~ | ~~**Terminology Services**~~ | | | | | | ~~Geïmplementeerd: $expand, $lookup, $translate~~ |
| ~~4~~ | ~~**XML Format**~~ | | | | | | ~~Geïmplementeerd: content negotiation via Accept header en _format parameter~~ |
| ~~5~~ | ~~**Binary Resource**~~ | | | | | | ~~Geïmplementeerd: raw content bij eigen MIME type, FHIR JSON/XML bij FHIR content types~~ |
| ~~6~~ | ~~**Referential Integrity**~~ | | | | | | ~~Geïmplementeerd: delete geblokkeerd als resource nog gerefereerd wordt~~ |

### Medium prioriteit — 3-4 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| ~~7~~ | ~~**$lastn**~~ | | | | | | ~~Geïmplementeerd: Observation/$lastn met max, patient, code, category filters~~ |
| ~~8~~ | ~~**Custom SearchParameters**~~ | | | | | | ~~Geïmplementeerd: runtime SearchParameter resources + $reindex operatie~~ |
| ~~9~~ | ~~**Cascading Deletes**~~ | | | | | | ~~Geïmplementeerd: _cascade=delete verwijdert afhankelijke resources recursief~~ |
| ~~10~~ | ~~**CORS**~~ | | | | | | ~~Geïmplementeerd: configureerbaar via CORS_ORIGIN env var~~ |
| 11 | **GraphQL** | ✅ | ✅ | — | ✅ | — | Alternatieve query interface per FHIR spec. Client vraagt precies de velden op die nodig zijn. |
| 12 | **Multi-tenancy** | — | ✅ | ✅ | — | — | Meerdere geïsoleerde tenants op één server-instantie met gescheiden datapools. |

### Lagere prioriteit — 2-3 concurrenten hebben dit

| # | Feature | Firely | HAPI | IBM | Google | Azure | Beschrijving |
|---|---------|--------|------|-----|--------|-------|-------------|
| ~~13~~ | ~~**$expunge**~~ | | | | | | ~~Geïmplementeerd: instance/type/system-level hard delete met expungeDeletedResources, expungeOldVersions, expungeEverything~~ |
| ~~14~~ | ~~**$reindex**~~ | | | | | | ~~Geïmplementeerd als onderdeel van Custom SearchParameters~~ |
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

### ~~Fase 2 — Klinische waarde~~ ✅ DONE
~~4. **Terminology Services** ($expand, $lookup, $translate) — kritiek voor validatie workflows~~
~~5. **$lastn** — hoge klinische waarde, veel gevraagd door clients~~
~~6. **Referential Integrity** — data kwaliteit en consistentie~~

### ~~Fase 3 — Uitbreidingen~~ ✅ DONE
~~7. **Binary Resource** handling~~
~~8. **XML Format** support~~
~~9. **Custom SearchParameters** + $reindex~~
~~10. **Cascading Deletes**~~

### Fase 4 — Geavanceerd
11. **$expunge** (GDPR)
12. **GraphQL**
13. **Multi-tenancy**
14. **Consent-based Access Control**