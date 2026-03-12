# Changelog

## [0.8.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.7.0...fhir-api-server-v0.8.0) (2026-03-12)


### Features

* add $expunge operation for hard delete / physical purge (GDPR/AVG) ([5aa66f5](https://github.com/martijn-on-fhir/fhir-api-server/commit/5aa66f5b9d0419553f6c0b57094b1ba0e5bc1b09))
* add $lastn, referential integrity and Insomnia updates (Phase 2) ([ed6a3b2](https://github.com/martijn-on-fhir/fhir-api-server/commit/ed6a3b22c80fbb8e359fa3ac835ba359bbb2b137))
* add FHIR terminology operations ($expand, $lookup, $translate) ([6e0ecd1](https://github.com/martijn-on-fhir/fhir-api-server/commit/6e0ecd17d7d792e64b191742fbd03184ef7e76e8))
* add PATCH, Compartment Search and CORS (Phase 1) ([0da7c68](https://github.com/martijn-on-fhir/fhir-api-server/commit/0da7c68529fd36fa60cf5d16af16fc2aefd5e533))
* add STU3 → R4 migration script for nl-core FHIR resources ([b36beda](https://github.com/martijn-on-fhir/fhir-api-server/commit/b36bedab8d977460501ff0b239e7923b0fb08aaf))
* add XML format on all routes, UCUM unit conversion and $diff operation ([54165e7](https://github.com/martijn-on-fhir/fhir-api-server/commit/54165e7515e13386c6a7f97313d8948e64878fff))
* add XML format, Binary resource, custom SearchParameters, $reindex and cascading deletes (Phase 3) ([a726120](https://github.com/martijn-on-fhir/fhir-api-server/commit/a726120e6199fe151557e09bd35133434b812135))


### Documentation

* add GraphQL and multi-tenancy implementation plans, remove outdated feature docs ([f4950f4](https://github.com/martijn-on-fhir/fhir-api-server/commit/f4950f410ff463be7663780081f97b1c9c5a1493))
* add JSDoc documentation to AdministrationService and ConformanceSeederService ([3268030](https://github.com/martijn-on-fhir/fhir-api-server/commit/3268030aa24fdccc939ded4b6044b2b7c6a9d45d))
* update README with all implemented features ([2cd3488](https://github.com/martijn-on-fhir/fhir-api-server/commit/2cd3488b975f5d18a06f7131c3818dbf6cdc6492))

## [0.7.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.6.0...fhir-api-server-v0.7.0) (2026-03-11)


### Features

* add /administration/metadata CapabilityStatement endpoint ([715861b](https://github.com/martijn-on-fhir/fhir-api-server/commit/715861b9513e65558d6444b74c0a991cda5bc60c))
* add AuditEvent for read, vread and search interactions ([2ee8a27](https://github.com/martijn-on-fhir/fhir-api-server/commit/2ee8a27a6186bcb3a18646d963d333e68120d19e))
* add AuditEvent resource generation for FHIR mutations ([d320d14](https://github.com/martijn-on-fhir/fhir-api-server/commit/d320d14af6a5ecdf3b07917a0b73eb561db52526))
* improve search pagination and add competitor analysis ([5319476](https://github.com/martijn-on-fhir/fhir-api-server/commit/5319476dc04727cb4d4ff2037a384cf3a5059ba8))
* switch validator to MongoDB source, remove filesystem dependencies ([50ac353](https://github.com/martijn-on-fhir/fhir-api-server/commit/50ac35399b221ba037be4b1f1516a2ad85e41cad))


### Bug Fixes

* resolve e2e test failures and remove obsolete terminology files ([8007aa7](https://github.com/martijn-on-fhir/fhir-api-server/commit/8007aa7632bac9befba3a5af8f8e01612d2e1159))


### Refactoring

* move SearchParameterRegistry to MongoDB-only, remove data/ directory ([6347b46](https://github.com/martijn-on-fhir/fhir-api-server/commit/6347b462c97f56aee888ce35a01e3cb6fd57c54b))

## [0.6.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.5.0...fhir-api-server-v0.6.0) (2026-03-11)


### Features

* add /administration endpoint for conformance resources (Firely-style) ([362346a](https://github.com/martijn-on-fhir/fhir-api-server/commit/362346aa657715df2310bce8473688d32d20ff72))


### Bug Fixes

* remove file-import COPY from Dockerfile to prevent CI build failure ([ad7c2ea](https://github.com/martijn-on-fhir/fhir-api-server/commit/ad7c2ea0950caf7d5a1028317e9ca3c49f74c2bb))

## [0.5.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.4.0...fhir-api-server-v0.5.0) (2026-03-10)


### Features

* add SMART on FHIR / OAuth2 authentication and authorization ([cd26bf1](https://github.com/martijn-on-fhir/fhir-api-server/commit/cd26bf1df6aec74947ceb61fc8951bd6010cc379))


### Bug Fixes

* increase SMART e2e test beforeAll timeout to 60s for CI ([173a421](https://github.com/martijn-on-fhir/fhir-api-server/commit/173a421cd2b75255baed1c3ba61da3bce1be8ce4))
* use explicit module composition in SMART e2e tests for CI ([201ba47](https://github.com/martijn-on-fhir/fhir-api-server/commit/201ba475a5b50babe67a33eee626650522f24538))

## [0.4.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.3.2...fhir-api-server-v0.4.0) (2026-03-10)


### Features

* add BgZ (Basisgegevensset Zorg) operation and update Insomnia collection ([bb80ede](https://github.com/martijn-on-fhir/fhir-api-server/commit/bb80ede3fb7353f126febfb61292c79cb58fc3c3))


### Bug Fixes

* resolve CI lint errors (jsdoc indentation, unused imports, style) ([1a5b170](https://github.com/martijn-on-fhir/fhir-api-server/commit/1a5b170c3c32b8047e94766272c8066232995533))

## [0.3.2](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.3.1...fhir-api-server-v0.3.2) (2026-03-10)


### Tests

* add 75 comprehensive search e2e tests ([e4405dd](https://github.com/martijn-on-fhir/fhir-api-server/commit/e4405dd6fcc72000f82141e601c0e80eaabdf6cb))

## [0.3.1](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.3.0...fhir-api-server-v0.3.1) (2026-03-10)


### Performance

* add MongoDB compound indexes for common FHIR search patterns ([d9b9104](https://github.com/martijn-on-fhir/fhir-api-server/commit/d9b9104de967094c60c1b47859873e125c79da28))

## [0.3.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.2.0...fhir-api-server-v0.3.0) (2026-03-10)


### Features

* add FHIR Bulk Data Export ($export) with async NDJSON processing ([0e660f6](https://github.com/martijn-on-fhir/fhir-api-server/commit/0e660f6f28e0ce0b01fbf29369179ace7cc2eace))

## [0.2.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.1.1...fhir-api-server-v0.2.0) (2026-03-10)


### Features

* add $everything operation for patient compartment ([c84daf2](https://github.com/martijn-on-fhir/fhir-api-server/commit/c84daf22919ea76492060271920eab52ce5056a6))

## [0.1.1](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.1.0...fhir-api-server-v0.1.1) (2026-03-10)


### Bug Fixes

* prevent NoSQL injection on search parameters ([2d2b6ad](https://github.com/martijn-on-fhir/fhir-api-server/commit/2d2b6adee5e5a5779cef040482b4a4e62f8278b8))

## [0.1.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.0.1...fhir-api-server-v0.1.0) (2026-03-10)


### Features

* add FHIR R4 Subscriptions and release-please changelog ([bf26d69](https://github.com/martijn-on-fhir/fhir-api-server/commit/bf26d694257d676841663654aa746ea2cf954749))
* add rate limiting and audit trail logging ([0198ea9](https://github.com/martijn-on-fhir/fhir-api-server/commit/0198ea92751768f1b039dce503cf3c7ea1311428))


### Bug Fixes

* remove release-type override so release-please-config.json is used ([cfcba0a](https://github.com/martijn-on-fhir/fhir-api-server/commit/cfcba0abd2f60b0197e68617a7fb72535dd75bf3))
