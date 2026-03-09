# FHIR API Server

> **THIS IS A PROOF OF CONCEPT AND IS NOT SUITABLE FOR PRODUCTION USE.**
>
> **DIT IS EEN PROOF OF CONCEPT EN IS NIET GESCHIKT VOOR PRODUCTIEGEBRUIK.**

A generic FHIR R4 REST API server built with NestJS and MongoDB.

## Features

- Generic FHIR REST endpoints: `GET`, `POST`, `PUT`, `DELETE` for any supported resource type
- FHIR-conformant responses: `Bundle` (searchset), `OperationOutcome`, `meta`, `ETag`, `Location` headers
- Search parameters: `_id`, `_sort`, `_count`, `_offset`
- Content-Type: `application/fhir+json`
- Absolute reference resolution in output
- FHIR R4 validation via [fhir-r4-validator](https://github.com/martijn-on-fhir/fhir-validator-r4)
- FHIR R4 type models via [fhir-models-r4](https://www.npmjs.com/package/fhir-models-r4)

## Supported Resource Types

Patient, Practitioner, Organization, Observation, Condition, Encounter, MedicationRequest, AllergyIntolerance, DiagnosticReport, Procedure, Appointment, Location

## Prerequisites

- Node.js 18+
- MongoDB running on `localhost:27017` (or set `MONGODB_URI` env var)

## Setup

```bash
npm install
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

# e2e tests
npm run test:e2e
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGODB_URI` | `mongodb://localhost:27017/fhir` | MongoDB connection string |
| `FHIR_PROFILES_DIR` | - | Directory with FHIR StructureDefinition JSON files |
| `FHIR_TERMINOLOGY_DIR` | - | Directory with ValueSet/CodeSystem JSON files |

## License

UNLICENSED
