# Changelog

## [0.12.2](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.12.1...fhir-api-server-v0.12.2) (2026-03-14)


### Documentation

* update application flow diagram to v0.12.0 ([789ee06](https://github.com/martijn-on-fhir/fhir-api-server/commit/789ee0656abb88a9b76b18f5964a1e18ca593bbf))

## [0.12.1](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.12.0...fhir-api-server-v0.12.1) (2026-03-14)


### Documentation

* move documentation to GitHub Wiki, clean up docs/ ([6abbbc5](https://github.com/martijn-on-fhir/fhir-api-server/commit/6abbbc5d99d39fd4658dec2b3780f6375c43d88c))

## [0.12.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.11.0...fhir-api-server-v0.12.0) (2026-03-14)


### Features

* add security policy, enable Dependabot alerts and updates ([d94cbcc](https://github.com/martijn-on-fhir/fhir-api-server/commit/d94cbccccdfbb479900b6cd10f1d154ced5e765e))


### Bug Fixes

* make backup-restore e2e test more robust for CI ([20baa89](https://github.com/martijn-on-fhir/fhir-api-server/commit/20baa89c68b98c4954fe4392f5a386c2343c799d))


### CI/CD

* upgrade actions/checkout to v6 ([08a595c](https://github.com/martijn-on-fhir/fhir-api-server/commit/08a595ca76ec5c8f5b69ebfe98cbbe4a3b8e6952))

## [0.11.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.10.0...fhir-api-server-v0.11.0) (2026-03-14)


### Features

* 30 min soak test passed — no memory leak detected ([4cbb043](https://github.com/martijn-on-fhir/fhir-api-server/commit/4cbb0431169f361cbd8b287fa4d6cc33f6c8fb30))

## [0.10.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.9.0...fhir-api-server-v0.10.0) (2026-03-14)


### Features

* add --scale parameter to load test seed script ([90e3d45](https://github.com/martijn-on-fhir/fhir-api-server/commit/90e3d45e6efbb241bae983e0d92de97bba8a2f0b))
* add automated backup & recovery with mongodump ([fb59c8e](https://github.com/martijn-on-fhir/fhir-api-server/commit/fb59c8e780c2ea64839012c243612f95c6a197b5))
* add FHIR Consent enforcement with deny-based access control ([91b7624](https://github.com/martijn-on-fhir/fhir-api-server/commit/91b7624c22ab4fb76246bc859251ab5b42441251))
* add full operational stack (Loki, MongoDB exporter, alerting, runbook, DR plan) ([2ad4bf2](https://github.com/martijn-on-fhir/fhir-api-server/commit/2ad4bf255e12d0b8fadcf8cb82513da590a02f11))
* add Grafana dashboard for FHIR API monitoring ([26e2f89](https://github.com/martijn-on-fhir/fhir-api-server/commit/26e2f89e6918bc9defe570cca2ee4cad8c0a42b5))
* add Grafana to docker-compose with auto-provisioned dashboard ([3e6ff67](https://github.com/martijn-on-fhir/fhir-api-server/commit/3e6ff670d4b17ac78f8a263565945a4fe1fadcd1))
* add Nginx TLS reverse proxy config and complete security review ([25d38e6](https://github.com/martijn-on-fhir/fhir-api-server/commit/25d38e6cbc35ef9e2af9cafc03797d96b48b49b4))
* add off-site backup support for AWS S3 and Azure Blob Storage ([ee6c067](https://github.com/martijn-on-fhir/fhir-api-server/commit/ee6c0671085aba83b9f8d9bc1368d811839cc0f0))
* add persistent MongoDB-backed job queue for bulk export ([fb250cf](https://github.com/martijn-on-fhir/fhir-api-server/commit/fb250cfa2d6d2bf35999f05c8a5c0af07259b5c1))
* complete phase 2 observability items ([31814cd](https://github.com/martijn-on-fhir/fhir-api-server/commit/31814cd42252bc3c3795c8492087a1395815736a))
* complete phase 2-3 (observability, security, compliance) ([e16c6a6](https://github.com/martijn-on-fhir/fhir-api-server/commit/e16c6a6af5abd6d9d31a70ae07be130a47d3c049))
* complete phase 4 with admin index-stats and db-stats endpoints ([b90d929](https://github.com/martijn-on-fhir/fhir-api-server/commit/b90d9297c861036bade286227e5239e1dcc208f4))
* load test with 15K resources — all thresholds passed ([7386b51](https://github.com/martijn-on-fhir/fhir-api-server/commit/7386b515ba755de4ab59a24c2261f3e346e7163b))


### Bug Fixes

* add FHIR API scrape target to Prometheus config ([ebfffb9](https://github.com/martijn-on-fhir/fhir-api-server/commit/ebfffb9cd3edf13a3b7caf380dfdb40b1cc24f1a))
* use literal datasource UID in Grafana dashboard ([389fb05](https://github.com/martijn-on-fhir/fhir-api-server/commit/389fb05b5e6059f2e54dc42f17a18b28a572232a))


### Documentation

* add 7 new Insomnia requests for admin endpoints (156 total) ([d5d9782](https://github.com/martijn-on-fhir/fhir-api-server/commit/d5d9782270f4744ae76c6c3aeb173880ad2374eb))
* add AVG verwerkersovereenkomst template ([76ae2ab](https://github.com/martijn-on-fhir/fhir-api-server/commit/76ae2ab671613ecf1b897e01a1a68ce8d8c59a27))
* add NEN 7510 self-assessment and DPIA ([c666c4b](https://github.com/martijn-on-fhir/fhir-api-server/commit/c666c4b583a5c632956c74b8f3b3d0b9caac55e5))
* remove Redis cache from production readiness plan ([1b7ee98](https://github.com/martijn-on-fhir/fhir-api-server/commit/1b7ee98071358c99507c32db3204b2067a1e4a48))
* update production readiness plan — scrap GraphQL, mark P0-P3 complete ([d024d58](https://github.com/martijn-on-fhir/fhir-api-server/commit/d024d58206725485612fd0b87393fb2377885b0f))
* update README with Grafana, consent, job queue and new env vars ([e87ecc6](https://github.com/martijn-on-fhir/fhir-api-server/commit/e87ecc6271f9ababcdb668606fec2d4883ee2282))


### Tests

* add backup/restore e2e tests with production-volume data ([3f569fb](https://github.com/martijn-on-fhir/fhir-api-server/commit/3f569fbec68fe631a33ae0eee99fa0fe9aca9983))


### CI/CD

* upgrade GitHub Actions to v5 for Node.js 24 compatibility ([b2bb0f6](https://github.com/martijn-on-fhir/fhir-api-server/commit/b2bb0f6b69a8004d381f09a67e67d457a143af1f))

## [0.9.0](https://github.com/martijn-on-fhir/fhir-api-server/compare/fhir-api-server-v0.8.0...fhir-api-server-v0.9.0) (2026-03-13)


### Features

* add admin module with snapshot and restore endpoints ([7e75a96](https://github.com/martijn-on-fhir/fhir-api-server/commit/7e75a9640ea88bec347c9d1b74abb80a0af09796))
* add FHIR R4 conformity features (Prefer header, conditional read, _total) ([a6c592a](https://github.com/martijn-on-fhir/fhir-api-server/commit/a6c592a982f7253ad2ee00fab41169fa14aa787a))
* add guard for dangerous operations with config-based feature flags ([5744858](https://github.com/martijn-on-fhir/fhir-api-server/commit/574485830acb805d48b586c33597af460333a948))
* add Jaeger tracing to docker-compose ([0df5632](https://github.com/martijn-on-fhir/fhir-api-server/commit/0df5632c9a4a3554d20a934c2170ac681a4d85db))
* add observability and resilience (phase 2) ([77c7d99](https://github.com/martijn-on-fhir/fhir-api-server/commit/77c7d992f794d237f30d78dc9194055cf462b03c))
* add performance and hardening features (phase 4) ([70026e9](https://github.com/martijn-on-fhir/fhir-api-server/commit/70026e9c9d570718aae7bbcfd367fb85fc625a04))
* add production infrastructure (phase 1) ([d79a103](https://github.com/martijn-on-fhir/fhir-api-server/commit/d79a1034a3a46853803c3c2be6deac9a1b03b889))
* add security and compliance features (phase 3) ([7db92a7](https://github.com/martijn-on-fhir/fhir-api-server/commit/7db92a731099a6037d53e4fd59f5ef4bbd78a3d1))
* add security hardening (helmet, timeout, body limits, CI audit) ([8c6b89c](https://github.com/martijn-on-fhir/fhir-api-server/commit/8c6b89c82ed7d46ba075855449f1a27a66299c8e))
* complete phase 1 infrastructure items and fix lint errors ([96a5e19](https://github.com/martijn-on-fhir/fhir-api-server/commit/96a5e192b24af1898832cc83bea3f8c7d8ff7b4c))
* optimize search performance and improve load testing setup ([5404ba7](https://github.com/martijn-on-fhir/fhir-api-server/commit/5404ba71d749a344d03142f886453b168fedec8b))
* upgrade NestJS 10 → 11 with Express v5 ([0cf5737](https://github.com/martijn-on-fhir/fhir-api-server/commit/0cf5737aa1dc9634abd0d1da2ef56618d79b543c))


### Bug Fixes

* add search outcome warnings and fix compartment search reference paths ([3648959](https://github.com/martijn-on-fhir/fhir-api-server/commit/36489594068f55a3a0810c4f4ece01ecd9714251))
* add XML body parsing to all mutation endpoints and fix mongo image tag ([617f78f](https://github.com/martijn-on-fhir/fhir-api-server/commit/617f78fb3e57f0a97293344ff574a0198cb52d48))
* **ci:** audit only production deps, lower threshold to critical ([9c45936](https://github.com/martijn-on-fhir/fhir-api-server/commit/9c459365ec8c4678236bf00a54ad974372013553))
* Docker build output path and add Jaeger SPM with OTel Collector ([5f1fbc4](https://github.com/martijn-on-fhir/fhir-api-server/commit/5f1fbc4e0942b06b7b4acfce457fac3af065e951))
* dynamically import AppModule in e2e test for CI compatibility ([2b606e2](https://github.com/martijn-on-fhir/fhir-api-server/commit/2b606e2dd893553573794e51606fd74133d923b7))
* regenerate package-lock.json without legacy-peer-deps ([b56c20a](https://github.com/martijn-on-fhir/fhir-api-server/commit/b56c20a26d75c530e33d6642613d36f8ebc1fd3d))
* telemetry config from app-config.json, Jaeger image tag, import ordering ([2dfbec1](https://github.com/martijn-on-fhir/fhir-api-server/commit/2dfbec1cff3da123ef3c9dba2040231b3ee192b2))
* use env var for MongoDB URI in app e2e test ([42429c0](https://github.com/martijn-on-fhir/fhir-api-server/commit/42429c01485694d09aa5a04a59e83c742dd60403))


### Documentation

* add JSDoc documentation to search query builder functions and properties ([91ea7b3](https://github.com/martijn-on-fhir/fhir-api-server/commit/91ea7b3788fcfed6b2ded98edc2ec91215d19c28))
* add production readiness plan ([27d9b2a](https://github.com/martijn-on-fhir/fhir-api-server/commit/27d9b2acf09736d41f4d311ce6a13c761da5c5b8))

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
