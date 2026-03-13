# GDPR / AVG Procedure — Recht op verwijdering

Dit document beschrijft de procedure voor het verwijderen van patiëntdata conform de AVG (Algemene Verordening Gegevensbescherming) / GDPR.

## Overzicht

De FHIR API server ondersteunt twee niveaus van data verwijdering:

1. **Soft delete** (standaard) — resource wordt gemarkeerd als verwijderd, historie blijft bewaard
2. **Hard delete / $expunge** — resource en alle versies worden permanent verwijderd uit de database

## Procedure bij verwijderingsverzoek

### Stap 1: Identificeer alle patiëntdata

Zoek alle resources die aan de patiënt gekoppeld zijn via het Patient compartment:

```
GET /fhir/Patient/{id}/$everything
```

Dit retourneert alle resources in het Patient compartment (Observations, Conditions, Encounters, etc.).

### Stap 2: Verwijder patiëntdata met cascade delete

Gebruik cascade delete om de patiënt en alle gerelateerde resources in één keer te verwijderen:

```
DELETE /fhir/Patient/{id}?_cascade=delete
```

**Let op:** Dit vereist dat `SERVER_CASCADE_DELETE_ENABLED=true` is ingesteld.

Dit verwijdert (soft delete):
- De Patient resource zelf
- Alle resources die direct naar deze Patient verwijzen

### Stap 3: Permanent verwijderen met $expunge

Na soft delete, gebruik `$expunge` om de data permanent uit de database te verwijderen:

```
POST /fhir/Patient/{id}/$expunge
```

**Let op:** Dit vereist dat `SERVER_EXPUNGE_ENABLED=true` is ingesteld.

De `$expunge` operatie ondersteunt drie niveaus:
- **Instance level**: `POST /fhir/Patient/{id}/$expunge` — verwijdert één resource + historie
- **Type level**: `POST /fhir/Patient/$expunge` — verwijdert alle soft-deleted Patients
- **System level**: `POST /fhir/$expunge` — verwijdert alle soft-deleted resources

### Stap 4: AuditEvent bewaren

AuditEvent en Provenance resources zijn **immutable** — ze kunnen niet gewijzigd of verwijderd worden via de API. Dit is bewust ontworpen voor:

- **Wettelijke bewaarplicht**: audit trail moet minimaal 5 jaar bewaard worden (NEN 7513)
- **Verantwoording**: het verwijderingsverzoek zelf moet traceerbaar zijn

Bij een verwijderingsverzoek:
1. AuditEvents met patiëntdata worden **geanonimiseerd** (patient referentie verwijderd)
2. Het AuditEvent van de verwijdering zelf wordt bewaard als bewijs van uitvoering

### Stap 5: Verificatie

Verifieer dat alle patiëntdata is verwijderd:

```
GET /fhir/Patient/{id}
→ 410 Gone (soft delete) of 404 Not Found (na $expunge)

GET /fhir/Patient/{id}/$everything
→ 404 Not Found
```

## Configuratie

| Env var | Vereist voor | Default |
|---------|-------------|---------|
| `SERVER_CASCADE_DELETE_ENABLED` | Cascade delete | `false` |
| `SERVER_EXPUNGE_ENABLED` | $expunge (permanent verwijderen) | `false` |

## Bewaartermijnen

| Resourcetype | Bewaartermijn | Bron |
|-------------|--------------|------|
| AuditEvent | Minimaal 5 jaar | NEN 7513 |
| Provenance | Minimaal 5 jaar | NEN 7513 |
| Klinische data | Minimaal 20 jaar | WGBO |
| Na verwijderingsverzoek | Direct | AVG Art. 17 |

**NB:** Het recht op verwijdering (AVG Art. 17) kan geblokkeerd worden door de wettelijke bewaarplicht (WGBO). In de praktijk moet per verzoek beoordeeld worden of de bewaarplicht of het verwijderingsrecht prevaleert. Dit is een organisatorische beslissing, niet een technische.

## Automatisch retentiebeleid

De server biedt momenteel geen automatisch retentiebeleid. Aanbevolen aanpak:
- Gebruik een externe scheduler (cron) die periodiek `$expunge` aanroept voor verlopen resources
- TTL indexes op MongoDB niveau voor AuditEvent resources (configureerbaar)
