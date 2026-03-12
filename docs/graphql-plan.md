# FHIR GraphQL Implementatieplan

## Overzicht

De FHIR GraphQL specificatie (http://hl7.org/fhir/graphql.html) definieert een GraphQL-interface bovenop de bestaande FHIR REST API. Dit plan beschrijft hoe we dit toevoegen als een nieuwe module binnen de bestaande NestJS-architectuur, zonder de huidige REST-functionaliteit te wijzigen.

**Kernbeslissing: schema-first met dynamische generatie.** Het GraphQL-schema wordt bij serverstart dynamisch opgebouwd uit StructureDefinition-resources in de `conformance_resources` MongoDB-collectie. Dit past bij de bestaande generieke architectuur (geen code per resourcetype) en zorgt ervoor dat het schema automatisch up-to-date is wanneer nieuwe StructureDefinitions worden geladen.

**Package-keuze:** We gebruiken `graphql`, `@graphql-tools/schema` en `dataloader`. Geen `@nestjs/graphql` of Apollo nodig — we voeren GraphQL execution zelf uit vanuit een REST controller (conform FHIR spec: `$graphql` is een operatie op bestaande routes). Dit houdt de implementatie simpel en voorkomt conflicten met de bestaande REST-routes.

## Bestandsstructuur

```
src/fhir/graphql/
  graphql.module.ts                  NestJS module registratie
  graphql.controller.ts              REST endpoints voor $graphql operatie
  schema/
    schema-generator.service.ts      Genereert GraphQL schema uit StructureDefinitions
    type-builder.ts                  Bouwt GraphQL ObjectTypes uit FHIR elementen
    scalar-types.ts                  FHIR-specifieke scalars (instant, date, uri, etc.)
    search-args-builder.ts           Maakt GraphQL arguments van SearchParameter defs
    reference-resolver.ts            Resolves FHIR references als navigeerbare links
  resolvers/
    resource-resolver.service.ts     Dynamische resolvers voor read/search/mutations
    connection-types.ts              Bundle-achtige connection types voor paginering
  graphql.types.ts                   TypeScript interfaces voor GraphQL context etc.
```

## Dependencies

```json
{
  "graphql": "^16.8.0",
  "@graphql-tools/schema": "^10.0.0",
  "@graphql-tools/utils": "^10.0.0",
  "dataloader": "^2.2.2"
}
```

## Technische Details

### 1. GraphQL Controller

De FHIR GraphQL spec definieert drie niveaus, elk als `$graphql` operatie:

```
GET/POST /fhir/$graphql                        # System-level
GET/POST /fhir/:resourceType/$graphql          # Type-level
GET/POST /fhir/:resourceType/:id/$graphql      # Instance-level
```

De controller ontvangt de GraphQL query (via `query` queryparameter bij GET, of als body bij POST), voert deze uit via `graphql`'s `execute()` functie, en retourneert het resultaat als `application/json`. Dit is een gewone NestJS REST controller — geen Apollo/Mercurius middleware nodig.

Routes worden geregistreerd met `@Get('\\$graphql')` / `@Post('\\$graphql')`, vergelijkbaar met bestaande operaties als `$validate`, `$expunge` etc.

### 2. Schema Generator (hart van de implementatie)

Bij `onModuleInit()`:

1. Laad alle StructureDefinition resources uit `conformance_resources` collectie
2. Filter op `kind === 'resource'` en `derivation !== 'constraint'` (alleen base definitions)
3. Bouw per resourcetype een GraphQL ObjectType op basis van `snapshot.element[]`
4. Registreer search parameters als arguments op type-level query velden
5. Genereer het volledige schema met `makeExecutableSchema()`

**FHIR-naar-GraphQL type mapping:**

| FHIR Type | GraphQL Type |
|-----------|-------------|
| `string`, `code`, `id`, `markdown`, `uri`, `url`, `canonical` | `String` |
| `boolean` | `Boolean` |
| `integer`, `positiveInt`, `unsignedInt` | `Int` |
| `decimal` | `Float` |
| `instant`, `date`, `dateTime`, `time` | Custom scalars |
| Complex types (`HumanName`, `Address`, `CodeableConcept`) | Nested ObjectTypes |
| `Reference` | Speciaal type met `reference` (String) + `resource` (navigeerbaar) |
| Backbone elements | Inline ObjectTypes: `{ResourceType}_{elementPath}` |
| Choice types (`value[x]`) | Meerdere velden: `valueString`, `valueQuantity`, etc. |

**Schema caching:** Het gegenereerde schema wordt in-memory gecached. Bij `$reindex` of wijzigingen aan StructureDefinitions kan het schema opnieuw gegenereerd worden via een `reload()` methode.

### 3. Reference Resolver (key feature)

FHIR GraphQL maakt referenties navigeerbaar. Wanneer een `Reference` veld wordt opgelost:

1. Parse het `reference` veld (bijv. `Patient/123`)
2. Extraheer `resourceType` en `id`
3. Gebruik `FhirService.findById()` om de gerefereerde resource op te halen

```graphql
type Reference {
  reference: String
  type: String
  display: String
  identifier: Identifier
  resource: Resource  # Union type van alle resource types
}
```

**DataLoader pattern:** Om N+1 query-problemen te voorkomen gebruiken we een DataLoader per request. De DataLoader batcht meerdere `findById` calls in een enkele MongoDB `$in` query.

**Contained resources:** Referenties met `#id` worden opgelost naar het `contained[]` array van de parent resource, zonder database query.

### 4. Search Arguments Builder

Hergebruikt de bestaande `SearchParameterRegistry` om per resourcetype de beschikbare zoekparameters op te halen. Elk search parameter wordt een GraphQL argument:

```graphql
type Query {
  PatientList(
    name: String
    gender: String
    birthdate: String     # FHIR date prefix syntax: "ge2000-01-01"
    identifier: String    # FHIR token syntax: "system|value"
    _count: Int
    _offset: Int
    _sort: String
  ): PatientConnection
}
```

Alle search parameters worden als `String` arguments doorgegeven om de bestaande FHIR search syntax intact te houden. De `QueryBuilderService` parst deze al correct.

### 5. Connection Types (paginering)

```graphql
type PatientConnection {
  count: Int
  offset: Int
  pageSize: Int
  first: Patient
  previous: String
  next: String
  entry: [PatientEntry]
}

type PatientEntry {
  resource: Patient
}
```

### 6. Resolvers

**Instance-level:** `Patient(id: ID!): Patient` — delegeert naar `FhirService.findById()`

**Type-level:** `PatientList(...searchParams): PatientConnection` — delegeert naar `FhirService.search()`

**System-level:** Combineert alle type-queries in root Query.

**Mutations (fase 5):**
```graphql
type Mutation {
  PatientCreate(resource: PatientInput!): PatientCreateResult
  PatientUpdate(id: ID!, resource: PatientInput!): PatientUpdateResult
  PatientDelete(id: ID!): PatientDeleteResult
}
```

### 7. SMART on FHIR Integratie

De bestaande `SmartAuthGuard` beschermt alle `/fhir/*` routes. Omdat `$graphql` endpoints gewone REST routes zijn onder `/fhir/`, werkt de guard automatisch.

Extra overwegingen:
- **Scope checking per veld:** Bij referentie-navigatie kunnen meerdere resourcetypes geraakt worden. De reference resolver checkt per resource of de JWT scopes toegang geven.
- **Action mapping:** GraphQL queries zijn `read`, mutations zijn `write`. `resolveAction()` moet POST naar `$graphql` als `read` behandelen.
- **Patient-context scoping:** Bij `patient/*` scopes filtert de resolver alleen resources van de patient uit het launch-context.
- **Query depth limiting:** Voorkom DoS via diep geneste referenties (max ~10 niveaus).

## Implementatiefasen

### Fase 1: Core Schema Generator + Instance-level Queries
**Doel:** `GET /fhir/Patient/123/$graphql?query={name{family given}}` werkt.

1. Scalar types voor FHIR datatypes
2. `SchemaGeneratorService`: lees StructureDefinitions, bouw GraphQL types
3. `GraphqlController` met instance-level routes
4. Resolvers: instance-level read via `FhirService.findById()`
5. E2e tests

**~800-1200 regels**

### Fase 2: Reference Navigation + DataLoader
**Doel:** `{managingOrganization{resource{...on Organization{name}}}}` werkt.

1. Reference type met `resource` veld
2. `ReferenceResolverService` met DataLoader batching
3. Resource union type
4. E2e tests: reference navigatie, nested queries

**~400-600 regels**

### Fase 3: Type-level Search Queries
**Doel:** `GET /fhir/Patient/$graphql?query={PatientList(name:"test"){entry{resource{name{family}}}}}` werkt.

1. `SearchArgsBuilderService`
2. Connection types voor paginering
3. Search resolvers via `FhirService.search()`
4. E2e tests

**~400-600 regels**

### Fase 4: System-level Queries + Cross-type
**Doel:** `GET /fhir/$graphql?query={PatientList{...} ObservationList{...}}` werkt.

1. System-level route
2. Combineer alle type-queries in root Query

**~100-200 regels**

### Fase 5: Mutations
**Doel:** Create, Update, Delete via GraphQL.

1. Genereer Input types uit StructureDefinitions
2. Mutation resolvers via `FhirService`
3. `FhirValidationPipe` integratie

**~500-700 regels**

### Fase 6: SMART Scopes + Productie-hardening
1. Per-resource scope checking in resolvers
2. Patient-context filtering
3. Query depth/complexity limiting
4. Introspection uitschakelen in productie
5. OperationOutcome in GraphQL errors
6. CapabilityStatement updaten

**~200-400 regels**

## Risico's

| Risico | Mitigatie |
|--------|-----------|
| Schema grootte (~150 resource types, ~600 complex types) | Lazy generatie: alleen types die in database voorkomen |
| Polymorphe velden (`value[x]`) | Correcte parsing van `snapshot.element` voor alle varianten |
| Circulaire referenties | Query depth limiting (max 10 niveaus) |
| N+1 query performance | DataLoader batching per request |
| Contained resources (`#id`) | Detectie in reference resolver, lokale lookup |
