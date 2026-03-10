# Bevindingen & Verbeterpunten

## Huidige staat

Het project heeft een werkende generieke FHIR R4 REST API met:
- CRUD operaties (create, read, update, delete)
- Search met alle parameter types (string, token, date, reference, number, quantity, uri, composite)
- Geavanceerde search: _include/_revinclude, _summary/_elements, chaining, _has, _text/_content
- POST _search, paginatie met next/previous links
- $validate operatie (type- en instance-level)
- CapabilityStatement met dynamische search parameters
- $meta, $meta-add, $meta-delete operaties
- FHIR validatie met nl-core profielen (fhir-validator-mx)
- Versie-historie: vRead, instance/type/system _history, soft deletes met tombstones
- Conditional CRUD: If-None-Exist, If-Match, conditional update/delete op search criteria
- Batch/Transaction Bundle: POST /fhir met urn:uuid referentie-resolutie
- Swagger/OpenAPI documentatie
- Insomnia collectie voor alle endpoints

## Verbeterpunten

### Fundamenteel (hoog impact)

1. ~~**Versie-historie (vHistory)** — `GET /Patient/123/_history` en `GET /Patient/_history`. Soft deletes, oude versies bewaren, vRead (`GET /Patient/123/_history/2`)~~ ✅ geïmplementeerd
2. ~~**Conditional CRUD** — `PUT /Patient?identifier=bsn|123` (create-or-update op basis van search), conditional delete, `If-Match` / `If-None-Match` headers~~ ✅ geïmplementeerd
3. ~~**Batch/Transaction Bundle** — `POST /fhir` met een Bundle van type `batch` of `transaction`, atomaire transacties met rollback~~ ✅ geïmplementeerd (zonder MongoDB transacties, vereist replica set)
4. ~~**Subscription** — FHIR R4 Subscriptions voor real-time notificaties (webhooks) bij resource wijzigingen~~ ✅ geïmplementeerd

### Kwaliteit & betrouwbaarheid

5. **Uitgebreide e2e tests** — tests voor alle search types, _include, chaining, _has, $validate, edge cases
6. **MongoDB indexen** — compound indexes op veelgebruikte search paden (identifier.system+value, code.coding, subject.reference) voor performance
7. ~~**Rate limiting & request logging** — bescherming tegen misbruik, audit trail~~ ✅ geïmplementeerd
8. **Input sanitization** — extra bescherming tegen NoSQL injection op search parameters

### Interoperabiliteit

9. **SMART on FHIR / OAuth2** — authenticatie en autorisatie, scopes per resource type, launch context
10. **Bulk Data Export ($export)** — `GET /fhir/$export` voor grote datasets als NDJSON, async processing
11. **$everything operation** — `GET /Patient/123/$everything` retourneert alles wat aan een patient gelinkt is
12. **Meer $operaties** — `$expand` (ValueSet), `$lookup` (CodeSystem), `$translate` (ConceptMap)

### NL-specifiek

13. **BgZ (Basisgegevensset Zorg)** — gestructureerde opvraag van de 26 BgZ zibs via een custom operation of standaard search
14. **MedMij/Nuts integratie** — aansluiting op het Nederlandse zorgnetwerk

### DevOps

15. ~~**Docker + docker-compose** — one-command setup met MongoDB~~ ✅ geimplementeerd
16. ~~**Health check endpoint** — `/health` met DB connectivity check~~ ✅ geimplementeerd
17. ~~**Structured logging** — JSON logs met correlation IDs voor tracing~~ ✅ geimplementeerd
18. ~~**CI/CD pipeline** — GitHub Actions met lint, test, build, docker push~~ ✅ geimplementeerd

## Prioriteit (top 3 aanbeveling)

1. ~~**Versie-historie** — essentieel voor FHIR conformiteit, veel clients verwachten dit~~ ✅ done
2. ~~**Batch/Transaction Bundle** — nodig voor bulk imports en atomaire operaties~~ ✅ done
3. ~~**Docker setup** — verlaagt de drempel voor anderen om het project te draaien~~ ✅ done

## Bugfixes uitgevoerd

- **String search op HumanName/Address** — `Patient?name=Schimmel` werkte niet omdat de StringQueryBuilder niet expandeerde naar sub-velden (family, given, etc.)
- **Token search op Identifier** — `Patient?identifier=system|value` matchte niet op `Identifier.value`, alleen op `Coding.code`
- **Token search op system zonder pipe** — `Patient?identifier=http://fhir.nl/fhir/NamingSystem/bsn` matchte niet op `.system`
- **meta.profile verloren bij create/update** — `fhir.service.ts` overschreef het hele meta object
- **Consent validatie met nl-core-AdvanceDirective** — verkeerde category/scope codes
