# Load Testing

k6 load tests voor de FHIR API server.

## Vereisten

- [k6](https://k6.io/docs/get-started/installation/) geïnstalleerd
- FHIR API server draaiend (met MongoDB)

## Gebruik

### 1. Seed testdata

```bash
node test/load/seed-data.js http://localhost:3000
```

Maakt 100 patients, 10 practitioners, 5 organizations, 200 encounters, 1000 observations en 200 conditions. IDs worden opgeslagen in `test/load/.seed-ids.json`.

### 2. Run scenarios

Individuele scenario's:

```bash
# Simple reads (target: p95 < 200ms)
k6 run test/load/scenarios/read.js

# Search queries (target: p95 < 500ms)
k6 run test/load/scenarios/search.js

# Mixed CRUD (50% read, 20% search, 15% create, 10% update, 5% metadata)
k6 run test/load/scenarios/crud-mix.js

# Transaction/batch bundles
k6 run test/load/scenarios/transaction.js

# Full mixed traffic (alle scenario's parallel)
k6 run test/load/scenarios/full.js
```

### 3. Custom base URL

```bash
k6 run -e BASE_URL=http://staging:3000 test/load/scenarios/read.js
```

## Scenario's

| Scenario | Beschrijving | Target |
|----------|-------------|--------|
| `read.js` | Reads op Patient, Observation, Encounter, metadata | p95 < 200ms |
| `search.js` | Diverse zoekqueries met filters, sort, includes | p95 < 500ms |
| `crud-mix.js` | Realistisch mix: 50% read, 20% search, 15% create, 10% update | p95 < 500ms |
| `transaction.js` | Transaction en batch bundles met 10 entries | p95 < 2s |
| `full.js` | Alle scenario's parallel (100 reads/s, 30 searches/s, 10 writes/s) | p95 < 500ms |

## Thresholds

- Error rate < 1%
- Simple reads: p50 < 50ms, p95 < 200ms, p99 < 500ms
- Search queries: p50 < 100ms, p95 < 500ms, p99 < 1000ms
- Transactions: p95 < 2000ms
