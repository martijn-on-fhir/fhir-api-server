# Data Protection Impact Assessment (DPIA)

> **Versie:** 1.0
>
> **Datum:** 2026-03-14
>
> **Status:** Concept — moet worden afgestemd op de specifieke verwerkingssituatie van de organisatie.

Dit document is opgesteld conform de AVG (Algemene Verordening Gegevensbescherming) artikel 35. Een DPIA is verplicht wanneer een verwerking waarschijnlijk een hoog risico inhoudt voor de rechten en vrijheden van natuurlijke personen, zoals bij verwerking van gezondheidsgegevens op grote schaal.

---

## 1. Beschrijving van de verwerking

### 1.1 Wat wordt verwerkt?

De FHIR API Server verwerkt **medische gegevens** conform de FHIR R4 standaard. Dit omvat:

| Resourcetype | Gegevens | Bijzondere categorie (art. 9) |
|-------------|----------|-------------------------------|
| Patient | NAW-gegevens, BSN, geboortedatum, geslacht | Ja (indirect via medische context) |
| Observation | Meetwaarden (bloeddruk, lab, etc.) | Ja (gezondheidsgegevens) |
| Condition | Diagnoses, aandoeningen | Ja (gezondheidsgegevens) |
| MedicationRequest | Medicatievoorschriften | Ja (gezondheidsgegevens) |
| AllergyIntolerance | Allergieën en intoleranties | Ja (gezondheidsgegevens) |
| Encounter | Consulten, opnames | Ja (gezondheidsgegevens) |
| Practitioner | Zorgverlener gegevens (naam, BIG) | Nee |
| Organization | Zorginstelling gegevens | Nee |
| Consent | Toestemmingsverklaringen | Ja (indirect) |
| AuditEvent | Audit trail (wie heeft wat wanneer gedaan) | Nee |

### 1.2 Doel van de verwerking

- Opslaan en ontsluiten van medische gegevens ten behoeve van directe patiëntenzorg
- Uitwisseling van zorggegevens tussen zorgsystemen via de FHIR R4 standaard
- Ondersteuning van de Basisgegevensset Zorg (BgZ) en nl-core profielen

### 1.3 Grondslag (art. 6 en 9 AVG)

| Grondslag | Toelichting |
|-----------|-------------|
| Art. 6.1(c) — Wettelijke verplichting | WGBO verplicht tot het bijhouden van een medisch dossier |
| Art. 9.2(h) — Gezondheidsgegevens | Verwerking noodzakelijk voor doeleinden van preventieve of arbeidsgeneeskunde, medische diagnosen, verstrekking van gezondheidszorg |
| Art. 6.1(a) — Toestemming | Consent resources registreren expliciete toestemming/weigering van de patiënt |

### 1.4 Betrokkenen

- **Patiënten** — personen waarvan medische gegevens worden verwerkt
- **Zorgverleners** — practitioners die gegevens raadplegen en vastleggen
- **Zorginstelling** — verwerkingsverantwoordelijke
- **Applicatiebeheerder** — technisch beheer van de server

### 1.5 Bewaartermijnen

| Gegevens | Bewaartermijn | Grondslag |
|----------|---------------|-----------|
| Medisch dossier | 20 jaar na laatste wijziging | WGBO art. 7:454 BW |
| AuditEvent (logging) | Minimaal 5 jaar | NEN 7513 |
| Backups | 7 dagen (configureerbaar) | Operationeel |

---

## 2. Noodzakelijkheids- en evenredigheidstoets

### 2.1 Is de verwerking noodzakelijk?

**Ja.** De WGBO verplicht zorgverleners tot het bijhouden van een medisch dossier. De FHIR standaard is de Nederlandse norm voor gegevensuitwisseling in de zorg (MedMij, Nictiz).

### 2.2 Wordt niet meer verwerkt dan nodig?

**Ja.** De server slaat alleen op wat via de FHIR API wordt aangeleverd. Er worden geen aanvullende gegevens verzameld. Zoekresultaten worden gefilterd op basis van:
- SMART scopes (alleen geautoriseerde resourcetypes)
- Patient-context (alleen data van de geautoriseerde patiënt)
- Consent restricties (door de patiënt ingestelde beperkingen)

### 2.3 Kunnen betrokkenen hun rechten uitoefenen?

| Recht | Implementatie |
|-------|---------------|
| **Inzage** (art. 15) | `GET /fhir/Patient/$everything` — alle gegevens van een patiënt |
| **Rectificatie** (art. 16) | `PUT /fhir/:resourceType/:id` — wijzigen van onjuiste gegevens |
| **Verwijdering** (art. 17) | `$expunge` operatie voor fysieke verwijdering. Procedure: `docs/gdpr-procedure.md` |
| **Beperking** (art. 18) | Consent resources met deny provisions beperken toegang |
| **Overdraagbaarheid** (art. 20) | `$export` operatie voor bulk data export in NDJSON formaat |
| **Bezwaar** (art. 21) | Consent resources registreren bezwaar tegen specifieke verwerkingen |

---

## 3. Risicobeoordeling

### 3.1 Geïdentificeerde risico's

| # | Risico | Impact | Kans | Risico-niveau | Maatregel |
|---|--------|--------|------|---------------|-----------|
| R1 | Ongeautoriseerde toegang tot medische gegevens | Hoog | Laag | **Gemiddeld** | SMART on FHIR OAuth2 met JWT/JWKS, scope enforcement, patient-context filtering, consent enforcement |
| R2 | Dataverlies door technisch falen | Hoog | Laag | **Gemiddeld** | Geautomatiseerde backups (24h), MongoDB replica set, graceful shutdown |
| R3 | Datalekken via API responses | Hoog | Laag | **Gemiddeld** | Input validatie, NoSQL injection preventie, XXE preventie, CORS beleid, security headers |
| R4 | Ongeautoriseerde wijziging van medische gegevens | Hoog | Laag | **Gemiddeld** | ETag/If-Match voor optimistic locking, versie-historie, audit trail (immutable AuditEvents) |
| R5 | Niet-beschikbaarheid van het systeem | Gemiddeld | Gemiddeld | **Gemiddeld** | Health checks, circuit breakers, request timeout, Docker restart policies, connection pooling |
| R6 | Logging onvoldoende voor incident-onderzoek | Gemiddeld | Laag | **Laag** | Automatische AuditEvent logging, correlation IDs, OpenTelemetry tracing, structured JSON logs |
| R7 | Niet-naleving bewaartermijnen | Gemiddeld | Gemiddeld | **Gemiddeld** | Configureerbare retentie (`AUDIT_RETENTION_DAYS`). **Let op: default 365 dagen, moet 1825 zijn voor NEN 7513.** Medische data heeft geen automatische verwijdering (WGBO 20 jaar). |
| R8 | Misbruik van admin-operaties | Hoog | Laag | **Gemiddeld** | Alle destructieve operaties standaard disabled. DangerousOperationGuard vereist expliciete activering. |
| R9 | Onderschepping van data in transit | Hoog | Laag | **Laag** | HSTS header, TLS termination op reverse proxy. **Actie: TLS configureren voor productie.** |
| R10 | Insider threat (medewerker misbruikt toegang) | Hoog | Laag | **Gemiddeld** | Audit trail loggen alle acties inclusief gebruiker. Rate limiting per client identity. Consent enforcement beperkt scope. |

### 3.2 Restrisico's

Na implementatie van alle maatregelen resteren de volgende risico's:

1. **Compromittering van de authorization server** — als de OAuth2 provider gecompromitteerd wordt, kunnen ongeautoriseerde tokens worden uitgegeven. Mitigatie: JWKS key rotation, korte token levensduur.
2. **MongoDB server compromittering** — als de database direct toegankelijk is, zijn alle gegevens beschikbaar. Mitigatie: netwerk isolatie (Docker), MongoDB authentication, encryption at rest.
3. **Zero-day kwetsbaarheden** — onbekende kwetsbaarheden in dependencies. Mitigatie: `npm audit` in CI, regelmatige updates, minimale Alpine Docker image.

---

## 4. Maatregelen

### 4.1 Technische maatregelen (geïmplementeerd)

| Maatregel | Implementatie | Verwijzing |
|-----------|---------------|------------|
| Authenticatie | SMART on FHIR / OAuth2 met JWT/JWKS | `src/fhir/guards/smart-auth.guard.ts` |
| Autorisatie | Scope enforcement per resource type + operatie | `src/fhir/smart/smart-scopes.ts` |
| Patient-context filtering | Compartment-gebaseerde data filtering | `src/fhir/fhir.controller.ts` |
| Consent enforcement | FHIR Consent resources met deny provisions | `src/fhir/consent/consent-enforcement.service.ts` |
| Audit logging | Automatische AuditEvent resources, immutable | `src/fhir/audit/audit-event.service.ts` |
| Input validatie | FHIR profiel validatie, NoSQL injection preventie, XXE preventie | `src/fhir/validation/`, `src/fhir/search/sanitize.ts` |
| Rate limiting | Dual-window throttling per client identity | `src/fhir/guards/fhir-throttler.guard.ts` |
| Data integriteit | ETag, versie-historie, optimistic locking | `src/fhir/fhir.service.ts` |
| Backup | Geautomatiseerde mongodump met retentie | `src/admin/backup.service.ts` |
| Monitoring | Prometheus metrics, Grafana dashboard, OpenTelemetry tracing | `src/metrics/`, `src/telemetry/` |
| Security headers | Helmet (HSTS, CSP, X-Frame-Options, etc.) | `src/main.ts` |
| Container security | Non-root user, Alpine image, multi-stage build | `Dockerfile` |

### 4.2 Organisatorische maatregelen (nodig)

| Maatregel | Actie |
|-----------|-------|
| Verwerkersovereenkomst | Opstellen voor elke partij die de server host of beheert |
| Incident response procedure | Beschrijf hoe te handelen bij een datalek (72-uur meldplicht AP) |
| Toegangsbeleid | Documenteer wie welke rollen heeft en hoe toegang wordt verleend/ingetrokken |
| Security awareness | Zorgverleners informeren over hun verantwoordelijkheden |
| Periodieke review | Jaarlijks deze DPIA herzien |

---

## 5. Conclusie

De FHIR API Server implementeert uitgebreide technische maatregelen om de risico's van het verwerken van medische gegevens te beperken. De restrisico's zijn **acceptabel** mits:

1. TLS wordt geconfigureerd op de reverse proxy
2. `AUDIT_RETENTION_DAYS` wordt verhoogd naar 1825 (5 jaar, NEN 7513)
3. MongoDB authentication en encryption at rest worden geconfigureerd
4. De organisatorische maatregelen (verwerkersovereenkomst, incident response) worden opgesteld
5. CORS_ORIGIN wordt beperkt tot de specifieke client origins

---

## 6. Goedkeuring

| Rol | Naam | Datum | Handtekening |
|-----|------|-------|-------------|
| Verwerkingsverantwoordelijke | | | |
| Functionaris Gegevensbescherming | | | |
| Technisch verantwoordelijke | | | |
