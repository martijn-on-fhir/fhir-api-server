# FHIR API Server

> **Dit is een ontwikkelserver en is niet gevalideerd voor productiegebruik met patiëntdata.**
>
> **This is a development server and is not validated for production use with patient data.**

A generic FHIR R4 REST API server built with NestJS 11, TypeScript and MongoDB. Supports Dutch nl-core profiles, SMART on FHIR authentication, BgZ (Basisgegevensset Zorg) and a Firely-style administration API for conformance resources.

## Features

### FHIR REST API
- Generic CRUD endpoints for any FHIR R4 resource type (`GET`, `POST`, `PUT`, `DELETE`)
- FHIR-conformant responses: `Bundle` (searchset), `OperationOutcome`, `ETag`, `Location` headers
- Content negotiation: `application/fhir+json` and `application/fhir+xml` via `Accept` header or `_format` parameter
- PATCH: JSON Patch (RFC 6902) and FHIRPath Patch (Parameters resource)
- Version history: `vRead`, instance/type/system `_history`, soft deletes
- Conditional CRUD: `If-None-Exist`, `If-Match`, conditional update/delete
- Batch and Transaction Bundle support with `urn:uuid` reference resolution
- Referential integrity: delete blocked when resource is still referenced
- Cascading deletes (`_cascade=delete`)
- Absolute reference resolution in output (reverse proxy aware)
- Binary resource support with raw content negotiation

### Search
- All parameter types: string, token, reference, date, number, quantity, composite, URI
- Modifiers: `:exact`, `:contains`, `:missing`, `:not`, `:text`, `:of-type`, `:above`, `:below`
- Prefixes for date/number/quantity: `eq`, `ne`, `gt`, `lt`, `ge`, `le`, `sa`, `eb`, `ap`
- `_include` / `_revinclude` with `:iterate`
- Chained search (`subject:Patient.name`)
- Reverse chaining (`_has:Observation:subject:code`)
- `_sort`, `_count`, `_offset`, `_summary`, `_elements`, `_text`, `_content`
- `POST _search` with form-urlencoded body
- Pagination with `next`, `previous`, `first`, `last` links
- Compartment search: `Patient`, `Practitioner`, `Encounter` compartments
- Custom SearchParameter resources with `$reindex` operation
- UCUM unit conversion: quantity search automatically matches equivalent units (e.g. "1 kg" matches "1000 g", "1000000 mg")

### Operations
- `$validate` — type and instance level, with nl-core profile support
- `$everything` — Patient compartment linked resources
- `$bgz` — BgZ (Basisgegevensset Zorg): structured retrieval of 26 zibs
- `$export` — Bulk Data Export: async NDJSON processing with kick-off, polling, download and cancel
- `$meta`, `$meta-add`, `$meta-delete` — resource metadata management
- `$lastn` — last N observations per code, with patient/category/code filters
- `$expunge` — hard delete / physical purge at instance, type and system level (GDPR/AVG compliance)
- `$diff` — compare two versions of a resource or two arbitrary resources
- `$expand` — ValueSet expansion by URL or id, with filter and pagination
- `$lookup` — CodeSystem code lookup with designations and properties
- `$translate` — ConceptMap code translation
- `$reindex` — reload custom search parameter definitions
- `CapabilityStatement` at `/fhir/metadata`

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

### Security
- **SMART on FHIR / OAuth2** — JWT Bearer token validation via JWKS, SMART scope enforcement per resource type (toggleable via config)
- `/.well-known/smart-configuration` endpoint
- Rate limiting (short + long window)
- NoSQL injection protection
- CORS configuration for browser-based SMART apps
- CapabilityStatement reflects security settings when SMART is enabled

### Subscriptions
- FHIR R4 Subscription resources with criteria-based matching
- REST-hook channel notifications on resource create/update/delete

### Audit
- Automatic AuditEvent generation for read, vread, search, create, update and delete interactions
- Stored as FHIR AuditEvent resources, queryable via search

### Admin (Database Management)
- `POST /admin/snapshot` — export all FHIR health data (resources + history) as JSON
- `POST /admin/restore` — wipe FHIR health data and import a snapshot (conformance resources are not affected)
- Useful for creating and restoring uniform test datasets

### Infrastructure
- Structured JSON logging with correlation IDs
- Health check endpoints: `/health` (full status), `/health/live` (liveness), `/health/ready` (readiness)
- Prometheus metrics at `/metrics` (request count, duration, search/validation histograms)
- OpenTelemetry tracing support (opt-in via `OTEL_ENABLED=true`)
- Slow query logging (configurable threshold via `SLOW_QUERY_THRESHOLD_MS`)
- Circuit breaker for external service calls (JWKS)
- In-memory TTL cache for CapabilityStatement, conformance resources and terminology operations (configurable via `CACHE_TTL_MS`)
- Request size limits: max body size, max `_count`, max Bundle entries, max include results
- AuditEvent TTL index for automatic retention (configurable via `AUDIT_RETENTION_DAYS`)
- MongoDB replica set support with transaction atomicity for Bundle operations
- Configurable connection pooling (`MONGODB_POOL_SIZE`)
- MongoDB compound indexes for common search patterns
- Grafana dashboard with 18 panels (auto-provisioned via docker-compose)
- Persistent async job queue (MongoDB-backed, no Redis needed) for bulk export
- FHIR Consent enforcement: deny-based access control with actor/purpose-of-use filtering
- Docker + docker-compose support (MongoDB replica set, Jaeger, Prometheus, Grafana)
- GitHub Actions CI/CD (lint, test, build, Docker)
- Automated releases via release-please
- Swagger/OpenAPI documentation + Insomnia collection
- k6 load testing suite with seed data and 5 scenarios

## Architecture

```
/fhir/*                  Clinical data (Patient, Observation, etc.)
                         Collection: fhir_resources

/admin/*                 Database management (snapshot, restore)
                         Uses: fhir_resources, fhir_resource_history

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
- [k6](https://k6.io/docs/get-started/installation/) (optional, for load testing)
  ```bash
  # Windows
  winget install GrafanaLabs.k6
  # macOS
  brew install k6
  ```

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

# docker-compose (full stack: MongoDB, Prometheus, Grafana, Jaeger)
CORS_ORIGIN=http://localhost:3000 docker compose up -d
```

Docker-compose starts:
- **FHIR API** on `http://localhost:3000`
- **Grafana** on `http://localhost:3001` (admin/admin) — dashboard auto-provisioned
- **Jaeger** on `http://localhost:16686` — distributed tracing UI
- **Prometheus** on `http://localhost:9090` — metrics

## Test

```bash
# unit tests
npm test

# e2e tests (uses mongodb-memory-server, no MongoDB required)
npm run test:e2e

# single test file
npx jest --testPathPattern=<pattern>

# load tests (requires k6 installed and server running)
npm run test:load:seed   # seed 1500+ test resources
npm run test:load        # run full mixed traffic scenario
k6 run test/load/scenarios/read.js    # individual scenario
```

173 automated tests across 12 e2e test suites + unit tests.

### Load Testing (k6)

Load tests simulate realistic mixed traffic against a running server. Requires [k6](https://k6.io/) and a running FHIR server with MongoDB.

**1. Install k6**

```bash
# Windows
winget install GrafanaLabs.k6

# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Herstart je terminal na installatie zodat `k6` in je PATH staat.

**2. Start de server zonder rate limiting**

```bash
# Linux/macOS
RATE_LIMIT_DISABLED=true npm run start:dev

# Windows (PowerShell)
$env:RATE_LIMIT_DISABLED="true"; npm run start:dev
```

**3. Seed testdata**

In een tweede terminal:

```bash
npm run test:load:seed
```

Dit maakt 1500+ resources aan (100 patients, 10 practitioners, 5 organizations, 200 encounters, 1000 observations, 200 conditions). Resource IDs worden opgeslagen in `test/load/.seed-ids.json`.

**4. Run de load test**

```bash
# Volledig scenario (100 reads/s + 30 searches/s + 10 writes/s, 2 minuten)
npm run test:load

# Individuele scenario's
k6 run test/load/scenarios/read.js        # reads only (p95 < 200ms)
k6 run test/load/scenarios/search.js       # searches only (p95 < 500ms)
k6 run test/load/scenarios/crud-mix.js     # mixed CRUD
k6 run test/load/scenarios/transaction.js  # batch/transaction bundles

# Custom base URL
k6 run -e BASE_URL=http://staging:3000 test/load/scenarios/read.js
```

**Thresholds**

| Scenario | Target |
|----------|--------|
| Reads (Patient, Observation, Encounter, metadata) | p95 < 200ms |
| Searches (name, patient, code, date, `_include`) | p95 < 500ms |
| Writes (create, update) | p95 < 1000ms |
| Error rate | < 1% |

Zie [test/load/README.md](test/load/README.md) voor meer details.

## API Documentation

Swagger UI is available at `http://localhost:3000/api` when the server is running.

An [Insomnia collection](insomnia-collection.json) is included with example requests for all features.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGODB_URI` | `mongodb://localhost:27017/fhir` | MongoDB connection string |
| `MONGODB_POOL_SIZE` | `10` | MongoDB connection pool size |
| `MONGODB_MIN_POOL_SIZE` | `2` | MongoDB minimum pool connections |
| `LOG_FORMAT` | - | Set to `json` for structured JSON logging |
| `SLOW_QUERY_THRESHOLD_MS` | `500` | Log search queries slower than this (ms) |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry tracing (Jaeger UI at http://localhost:16686) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint (auto-configured in docker-compose) |
| `RATE_LIMIT_TTL` | `60` | Rate limit window in seconds |
| `RATE_LIMIT_MAX` | `5000` | Max requests per short window |
| `RATE_LIMIT_MAX_LONG` | `50000` | Max requests per 10-minute window |
| `RATE_LIMIT_DISABLED` | `false` | Disable rate limiting entirely (useful for load testing) |
| `SMART_ENABLED` | `false` | Enable SMART on FHIR authentication |
| `SMART_ISSUER` | - | JWT issuer (must match authorization server) |
| `SMART_AUDIENCE` | `fhir-api` | JWT audience |
| `SMART_JWKS_URI` | - | JWKS endpoint for token verification |
| `SMART_SCOPE_CLAIM` | `scope` | JWT claim containing SMART scopes |
| `SMART_AUTHORIZE_URL` | - | OAuth2 authorization endpoint |
| `SMART_TOKEN_URL` | - | OAuth2 token endpoint |
| `BODY_SIZE_LIMIT` | `5mb` | Max request body size |
| `MAX_COUNT` | `1000` | Max `_count` parameter value for search/history |
| `MAX_BUNDLE_ENTRIES` | `1000` | Max entries in a batch/transaction Bundle |
| `MAX_INCLUDE_RESULTS` | `1000` | Max resources returned via `_include`/`_revinclude` |
| `CACHE_TTL_MS` | `300000` | In-memory cache TTL in milliseconds (5 min) |
| `AUDIT_RETENTION_DAYS` | `365` | AuditEvent auto-deletion after N days (TTL index) |
| `CONSENT_CACHE_TTL_MS` | `60000` | Consent policy cache TTL in milliseconds (1 min) |
| `MAX_CONCURRENT_EXPORTS` | `3` | Max concurrent bulk export jobs |
| `BULK_EXPORT_TIMEOUT_MS` | `600000` | Bulk export job timeout (10 min) |
| `JOB_RETENTION_DAYS` | `7` | Completed job cleanup after N days |
| `MONGODB_SLOW_QUERY_MS` | `100` | MongoDB profiler threshold for slow queries (ms) |
| `CORS_ORIGIN` | `*` | Allowed CORS origins (comma-separated) |
| `SERVER_REINDEX_ENABLED` | `false` | Enable `$reindex` operation |
| `SERVER_EXPUNGE_ENABLED` | `false` | Enable `$expunge` operation (permanent data deletion) |
| `SERVER_CASCADE_DELETE_ENABLED` | `false` | Enable `_cascade=delete` (recursive delete) |
| `SERVER_SNAPSHOT_ENABLED` | `false` | Enable `POST /admin/snapshot` |
| `SERVER_RESTORE_ENABLED` | `false` | Enable `POST /admin/restore` |

SMART and server settings can also be configured in `config/app-config.json` (see `config/app-config.example.json`). Environment variables take precedence.

## STU3 → R4 Migration

A standalone CLI script is included for migrating FHIR STU3 resources (nl-core profiles) to R4. It works directly MongoDB-to-MongoDB for maximum performance.

### Supported Resource Types

Practitioner (+ PractitionerRole extraction), Patient, Organization, Location, Condition, Consent, AllergyIntolerance

### Usage

```bash
npx ts-node scripts/migrate-stu3/index.ts \
  --source mongodb://klant-db:27017/fhir-stu3 \
  --target mongodb://localhost:27017/fhir \
  --types Practitioner,Patient,Condition \
  --batch-size 500 \
  --dry-run
```

| Argument | Default | Description |
|----------|---------|-------------|
| `--source` | (required) | Source MongoDB URI with STU3 data |
| `--target` | `mongodb://localhost:27017/fhir` | Target MongoDB URI (R4 server) |
| `--types` | all supported | Comma-separated resource types to migrate |
| `--source-collection` | `fhir_resources` | Collection name in source DB |
| `--batch-size` | `500` | Resources per batch |
| `--dry-run` | `false` | Log what would happen without writing |

### Key Conversions

- **All resources**: profile URLs rewritten from `fhir.nl` to `nictiz.nl`, extension URLs updated, meta reset to versionId `1`
- **Practitioner**: embedded `role[]` extracted into separate PractitionerRole resources with deterministic IDs
- **Condition**: `assertedDate` → `recordedDate`, `clinicalStatus`/`verificationStatus` string → CodeableConcept
- **Consent**: `except[]` → `provision.provision[]`, `period`/`actor` moved into `provision`
- **AllergyIntolerance**: `clinicalStatus`/`verificationStatus` string → CodeableConcept
- **Location**: `type` single → array
- **Patient**: `animal` component removed

The script is idempotent (upsert on `{resourceType, id}`), preserves original IDs to maintain referential integrity, and continues on per-resource errors.

## License

UNLICENSED
