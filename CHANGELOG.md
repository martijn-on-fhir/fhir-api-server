# Changelog

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
