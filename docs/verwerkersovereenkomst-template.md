# Verwerkersovereenkomst (Template)

> **Status:** Template — vul de gemarkeerde velden in per klant-relatie.
>
> **Juridische disclaimer:** Dit template is opgesteld als startpunt en vervangt geen juridisch advies. Laat het document beoordelen door een jurist voordat het wordt ondertekend.

---

## Verwerkersovereenkomst

conform artikel 28 lid 3 van de Algemene Verordening Gegevensbescherming (AVG)

### Partijen

1. **Verwerkingsverantwoordelijke:**
   - Naam: `[NAAM ZORGINSTELLING]`
   - Adres: `[ADRES]`
   - KvK-nummer: `[KVK]`
   - Contactpersoon: `[NAAM]`
   - E-mail: `[E-MAIL]`
   - Hierna te noemen: "Verantwoordelijke"

2. **Verwerker:**
   - Naam: `[NAAM VERWERKER / HOSTING PARTIJ]`
   - Adres: `[ADRES]`
   - KvK-nummer: `[KVK]`
   - Contactpersoon: `[NAAM]`
   - E-mail: `[E-MAIL]`
   - Hierna te noemen: "Verwerker"

---

### Artikel 1 — Definities

1.1. **Persoonsgegevens:** alle informatie over een geïdentificeerde of identificeerbare natuurlijke persoon, waaronder medische gegevens (bijzondere categorie, art. 9 AVG).

1.2. **Verwerking:** elke bewerking van persoonsgegevens, waaronder het verzamelen, vastleggen, opslaan, wijzigen, opvragen, raadplegen, gebruiken, verstrekken, wissen of vernietigen van gegevens.

1.3. **Applicatie:** de FHIR R4 API Server inclusief de onderliggende database (MongoDB) en ondersteunende diensten (monitoring, backups).

1.4. **Betrokkene:** de natuurlijke persoon op wie de persoonsgegevens betrekking hebben (patiënt).

---

### Artikel 2 — Onderwerp en duur

2.1. Deze overeenkomst heeft betrekking op de verwerking van persoonsgegevens door Verwerker ten behoeve van Verantwoordelijke via de Applicatie.

2.2. De verwerking omvat:

| Aspect | Beschrijving |
|--------|-------------|
| Aard van de verwerking | Opslaan, ontsluiten en uitwisselen van medische gegevens via de FHIR R4 API |
| Doel | Ondersteuning van directe patiëntenzorg en gegevensuitwisseling tussen zorgsystemen |
| Soort gegevens | Medische gegevens (diagnoses, medicatie, meetwaarden, consulten), identificerende gegevens (naam, BSN, geboortedatum) |
| Categorieën betrokkenen | Patiënten, zorgverleners |
| Bewaartermijn | Conform WGBO: 20 jaar na laatste wijziging. Audit logging: minimaal 5 jaar (NEN 7513). |

2.3. Deze overeenkomst treedt in werking op `[DATUM]` en duurt voort zolang Verwerker persoonsgegevens verwerkt ten behoeve van Verantwoordelijke.

---

### Artikel 3 — Verplichtingen van de Verwerker

3.1. Verwerker verwerkt persoonsgegevens uitsluitend op basis van schriftelijke instructies van Verantwoordelijke, tenzij een wettelijke verplichting anders vereist.

3.2. Verwerker waarborgt dat personen die gemachtigd zijn om persoonsgegevens te verwerken, zich tot geheimhouding hebben verplicht.

3.3. Verwerker neemt de volgende technische en organisatorische beveiligingsmaatregelen:

**Toegangsbeveiliging:**
- SMART on FHIR / OAuth2 authenticatie met JWT/JWKS tokenvalidatie
- Autorisatie op basis van SMART scopes per resourcetype en operatie
- Patient-context filtering: data gefilterd op de geautoriseerde patiënt
- Consent enforcement: deny-based toegangsrestricties op basis van patiënt-toestemming
- Rate limiting per client identity (dual-window throttling)
- Destructieve operaties standaard uitgeschakeld (DangerousOperationGuard)

**Versleuteling:**
- TLS/HTTPS voor data in transit (HSTS met 1 jaar max-age)
- MongoDB Encryption at Rest op database-niveau (indien geconfigureerd)

**Logging en monitoring:**
- Automatische FHIR AuditEvent logging voor alle data-interacties
- Immutable audit trail (AuditEvent/Provenance niet wijzigbaar of verwijderbaar)
- Retentie: minimaal 5 jaar (NEN 7513), configureerbaar via `AUDIT_RETENTION_DAYS`
- Structured JSON logging met correlation IDs
- Prometheus metrics en Grafana dashboard voor real-time monitoring
- OpenTelemetry distributed tracing (optioneel)

**Databeveiliging:**
- Input validatie: FHIR R4 profiel validatie, NoSQL injection preventie, XXE preventie
- Versie-historie: elke wijziging bewaard met versionId en timestamp
- Optimistic locking via ETag/If-Match headers
- Security headers via Helmet (CSP, HSTS, X-Frame-Options)

**Back-up en herstel:**
- Geautomatiseerde dagelijkse backups via mongodump (configureerbaar interval)
- Backup retentie: 7 backups (configureerbaar)
- Recovery Time Objective (RTO): < 5 minuten
- Recovery Point Objective (RPO): configureerbaar (standaard 24 uur)

**Infrastructuur:**
- Docker containerisatie met non-root user
- Minimale Alpine Linux base image
- Netwerk isolatie via Docker networking
- Health checks voor beschikbaarheidsmonitoring

3.4. Volledige technische details zijn vastgelegd in het NEN 7510 self-assessment (`docs/nen7510-self-assessment.md`).

---

### Artikel 4 — Sub-verwerkers

4.1. Verwerker maakt gebruik van de volgende sub-verwerkers:

| Sub-verwerker | Dienst | Locatie |
|--------------|--------|---------|
| `[HOSTING PROVIDER]` | Server hosting / cloud infrastructure | `[LAND]` |
| `[DATABASE PROVIDER]` | MongoDB hosting (indien MongoDB Atlas) | `[LAND]` |

4.2. Verwerker schakelt geen andere sub-verwerkers in zonder voorafgaande schriftelijke toestemming van Verantwoordelijke.

4.3. Bij inschakeling van een sub-verwerker legt Verwerker dezelfde verplichtingen op als in deze overeenkomst.

---

### Artikel 5 — Rechten van betrokkenen

5.1. Verwerker ondersteunt Verantwoordelijke bij het nakomen van verzoeken van betrokkenen:

| Recht | Technische implementatie |
|-------|------------------------|
| Inzagerecht (art. 15) | `GET /fhir/Patient/{id}/$everything` |
| Rectificatie (art. 16) | `PUT /fhir/{resourceType}/{id}` |
| Verwijdering (art. 17) | `DELETE /fhir/Patient/{id}?_cascade=delete` gevolgd door `$expunge` |
| Beperking (art. 18) | Consent resources met deny provisions |
| Overdraagbaarheid (art. 20) | `GET /fhir/$export` (bulk data export in NDJSON) |
| Bezwaar (art. 21) | Consent resources registreren bezwaar |

5.2. Procedure voor recht op verwijdering is beschreven in `docs/gdpr-procedure.md`.

---

### Artikel 6 — Meldplicht datalekken

6.1. Verwerker informeert Verantwoordelijke **zonder onredelijke vertraging** en uiterlijk binnen **24 uur** na ontdekking van een inbreuk in verband met persoonsgegevens.

6.2. De melding bevat minimaal:
- Aard van de inbreuk
- Categorieën en geschat aantal betrokkenen
- Waarschijnlijke gevolgen
- Genomen en voorgestelde maatregelen

6.3. De audit trail (AuditEvent resources) dient als bewijsmateriaal bij het onderzoeken van een inbreuk.

---

### Artikel 7 — Geheimhouding

7.1. Verwerker behandelt alle persoonsgegevens als vertrouwelijk.

7.2. Verwerker zorgt ervoor dat alleen geautoriseerd personeel toegang heeft tot persoonsgegevens en dat dit personeel gebonden is aan geheimhouding.

---

### Artikel 8 — Audits

8.1. Verantwoordelijke heeft het recht om audits uit te (laten) voeren om naleving van deze overeenkomst te verifiëren.

8.2. Verwerker stelt de volgende informatie beschikbaar voor audits:
- NEN 7510 self-assessment (`docs/nen7510-self-assessment.md`)
- DPIA (`docs/dpia.md`)
- AuditEvent resources (via `GET /fhir/AuditEvent`)
- Database statistieken (via `GET /admin/db-stats`)
- Index usage statistieken (via `GET /admin/index-stats`)

8.3. Kosten van audits komen voor rekening van Verantwoordelijke, tenzij de audit wijst op niet-naleving door Verwerker.

---

### Artikel 9 — Beëindiging

9.1. Bij beëindiging van deze overeenkomst zal Verwerker, naar keuze van Verantwoordelijke:
- Alle persoonsgegevens retourneren via `$export` (bulk data export)
- Alle persoonsgegevens verwijderen via `$expunge` (fysieke verwijdering)

9.2. Verwerker verstrekt een schriftelijke bevestiging van verwijdering.

9.3. Backups worden verwijderd conform het retentiebeleid (standaard 7 dagen na laatste backup).

---

### Artikel 10 — Toepasselijk recht

10.1. Op deze overeenkomst is Nederlands recht van toepassing.

10.2. Geschillen worden voorgelegd aan de bevoegde rechter in `[PLAATS]`.

---

### Ondertekening

| | Verwerkingsverantwoordelijke | Verwerker |
|---|---|---|
| Naam | | |
| Functie | | |
| Datum | | |
| Handtekening | | |
