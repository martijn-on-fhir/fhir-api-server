# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | :white_check_mark: |
| < Latest | :x: |

Only the latest version receives security updates.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. Use [GitHub Security Advisories](https://github.com/martijn-on-fhir/fhir-api-server/security/advisories/new) to report privately
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

You can expect an initial response within 48 hours.

## Security Measures

This application implements the following security controls:

### Authentication & Authorization
- SMART on FHIR / OAuth2 with JWT/JWKS token validation
- Scope enforcement per resource type and operation
- Patient-context compartment filtering
- FHIR Consent enforcement (deny-based access control)

### Data Protection
- TLS/HTTPS via reverse proxy (Nginx config included)
- HSTS with 1-year max-age
- Security headers via Helmet (CSP, X-Frame-Options, X-Content-Type-Options)
- NoSQL injection prevention (input sanitization, `$` key stripping)
- XXE prevention in XML parser
- FHIR profile validation on all writes

### Audit & Monitoring
- Immutable FHIR AuditEvent logging for all data interactions
- Correlation IDs and OpenTelemetry trace IDs
- Prometheus metrics with Grafana alerting
- Structured JSON logging with Loki aggregation

### Access Control
- Rate limiting per client identity (dual-window)
- Dangerous operations disabled by default (DangerousOperationGuard)
- Request body size limits
- CORS policy enforcement

### Compliance
- NEN 7510 self-assessment (18 technical controls)
- DPIA (AVG article 35)
- GDPR right-to-erasure procedure (`$expunge`)
- NEN 7513 audit log retention (configurable)

## Dependencies

- Dependabot alerts and security updates are enabled
- `npm audit` runs in CI on every push
- Production dependencies are audited separately (`npm audit --omit=dev`)
