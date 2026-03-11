# FHIR API Server

> **THIS IS A PROOF OF CONCEPT AND IS NOT SUITABLE FOR PRODUCTION USE.**
>
> **DIT IS EEN PROOF OF CONCEPT EN IS NIET GESCHIKT VOOR PRODUCTIEGEBRUIK.**

A generic FHIR R4 REST API server built with NestJS 10, TypeScript and MongoDB. Supports Dutch nl-core profiles, SMART on FHIR authentication, BgZ (Basisgegevensset Zorg) and a Firely-style administration API for conformance resources.

## Features

### FHIR REST API
- Generic CRUD endpoints for any FHIR R4 resource type (`GET`, `POST`, `PUT`, `DELETE`)
- FHIR-conformant responses: `Bundle` (searchset), `OperationOutcome`, `ETag`, `Location` headers
- Content-Type: `application/fhir+json`
- Version history: `vRead`, instance/type/system `_history`, soft deletes
- Conditional CRUD: `If-None-Exist`, `If-Match` headers
- Batch and Transaction Bundle support
- Absolute reference resolution in output (reverse proxy aware)

### Administration API (Firely-style)
- Separate `/administration` endpoint for conformance resources
- CRUD for StructureDefinition, ValueSet, CodeSystem, SearchParameter, NamingSystem, ConceptMap, OperationDefinition, CompartmentDefinition, ImplementationGuide
- Dedicated `conformance_resources` MongoDB collection
- CapabilityStatement at `/administration/metadata`
- Startup seeder: imports conformance resources from `file-import/` directory recursively
- Seed-once mechanism with hash-based change detection (skips import when unchanged)
- Search by `url`, `name`, `version`, `status`

### Validation
- Profile-based validation on create and update via `fhir-validator-mx`
- Conformance resources loaded from MongoDB (no filesystem dependency)
- Externally resolved resources (Art-Decor, Nictiz) auto-persisted back to MongoDB
- `$validate` operation at type and instance level

### Search
- All parameter types: string, token, reference, date, number, quantity, composite, URI
- Modifiers: `:exact`, `:contains`, `:missing`, `:not`, `:text`, `:of-type`, `:above`, `:below`
- Prefixes for date/number/quantity: `eq`, `ne`, `gt`, `lt`, `ge`, `le`
- `_include` / `_revinclude` with `:iterate`
- Chained search (`subject:Patient.name`)
- Reverse chaining (`_has:Observation:subject:code`)
- `_sort`, `_count`, `_offset`, `_summary`, `_elements`

### Operations
- `$validate` — type and instance level, with nl-core profile support
- `$everything` — Patient compartment linked resources
- `$bgz` — BgZ (Basisgegevensset Zorg): structured retrieval of 26 zibs
- `$export` — Bulk Data Export: async NDJSON processing with kick-off, polling, download and cancel
- `$meta`, `$meta-add`, `$meta-delete` — resource metadata management
- `CapabilityStatement` at `/fhir/metadata`

### Security
- **SMART on FHIR / OAuth2** — JWT Bearer token validation via JWKS, SMART scope enforcement per resource type (toggleable via config)
- `/.well-known/smart-configuration` endpoint
- Rate limiting (short + long window)
- NoSQL injection protection
- CapabilityStatement reflects security settings when SMART is enabled

### Subscriptions
- FHIR R4 Subscription resources with criteria-based matching
- REST-hook channel notifications on resource create/update/delete

### Infrastructure
- Structured JSON logging with correlation IDs
- Audit middleware for mutation tracking
- Health check endpoint (`/health`)
- MongoDB compound indexes for common search patterns
- Docker + docker-compose support
- GitHub Actions CI/CD (lint, test, build, Docker)
- Automated releases via release-please

## Architecture

```
/fhir/*                  Clinical data (Patient, Observation, etc.)
                         Collection: fhir_resources

/administration/*        Conformance resources (StructureDefinition, ValueSet, etc.)
                         Collection: conformance_resources

file-import/             Seed data (loaded at startup into conformance_resources)
  profiles/r4-core/      FHIR R4 base StructureDefinitions
  profiles/nl-core/      Nictiz nl-core profiles
  terminology/r4-core/   FHIR R4 ValueSets and CodeSystems
  terminology/nl-core/   NL-core terminology
  data/                  SearchParameter definitions
```

The FHIR validator (`fhir-validator-mx`) reads conformance resources directly from the `conformance_resources` MongoDB collection. Externally resolved resources (Art-Decor, Nictiz terminologieserver) are automatically persisted back to MongoDB.

## Prerequisites

- Node.js 18+
- MongoDB running on `localhost:27017` (or set `MONGODB_URI` env var)

## Setup

```bash
npm install
cp config/app-config.example.json config/app-config.json
```

## Run

```bash
# development (watch mode)
npm run start:dev

# production
npm run build
npm run start:prod
```

## Test

```bash
# unit tests
npm test

# e2e tests (uses mongodb-memory-server, no MongoDB required)
npm run test:e2e

# single test file
npx jest --testPathPattern=<pattern>
```

161 automated tests across 10 e2e test suites + unit tests.

## API Documentation

Swagger UI is available at `http://localhost:3000/api` when the server is running.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGODB_URI` | `mongodb://localhost:27017/fhir` | MongoDB connection string |
| `LOG_FORMAT` | - | Set to `json` for structured JSON logging |
| `RATE_LIMIT_TTL` | `60` | Rate limit window in seconds |
| `RATE_LIMIT_MAX` | `100` | Max requests per short window |
| `RATE_LIMIT_MAX_LONG` | `1000` | Max requests per 10-minute window |
| `SMART_ENABLED` | `false` | Enable SMART on FHIR authentication |
| `SMART_ISSUER` | - | JWT issuer (must match authorization server) |
| `SMART_AUDIENCE` | `fhir-api` | JWT audience |
| `SMART_JWKS_URI` | - | JWKS endpoint for token verification |
| `SMART_SCOPE_CLAIM` | `scope` | JWT claim containing SMART scopes |
| `SMART_AUTHORIZE_URL` | - | OAuth2 authorization endpoint |
| `SMART_TOKEN_URL` | - | OAuth2 token endpoint |

SMART settings can also be configured in `config/app-config.json` (see `config/app-config.example.json`). Environment variables take precedence.

## License

UNLICENSED