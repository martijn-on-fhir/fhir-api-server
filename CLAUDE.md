# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FHIR API server built with NestJS 10 and TypeScript. Currently a fresh scaffold — the FHIR-specific implementation is yet to be built.

## Commands

- `npm run build` — compile TypeScript (NestJS CLI)
- `npm run start:dev` — run in watch mode for development
- `npm run lint` — ESLint with auto-fix
- `npm run format` — Prettier formatting
- `npm test` — run unit tests (Jest, matches `*.spec.ts` in `src/`)
- `npm run test:e2e` — run e2e tests (Jest, matches `*.e2e-spec.ts` in `test/`)
- `npx jest --testPathPattern=<pattern>` — run a single test file

## Architecture

Standard NestJS module structure:

- `src/main.ts` — bootstrap, listens on `PORT` env var or 3000
- `src/app.module.ts` — root module
- NestJS pattern: modules register controllers (HTTP) and providers (services/business logic) via decorators

## Code Style

- Prettier: single quotes, trailing commas
- ESLint: `@typescript-eslint/recommended` + Prettier integration
- `no-explicit-any` is allowed (rule is off)
- Strict null checks are disabled in tsconfig
