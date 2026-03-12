# Multi-Tenancy Implementatieplan — FHIR R4 API Server

## 1. Analyse van strategieen

### 1.1 URL-based tenant routing (`/t/{tenantId}/fhir/...`)

**Voordelen:**
- Expliciet en transparant: tenant is zichtbaar in elke URL
- Makkelijk te loggen, debuggen en testen
- Werkt goed met reverse proxies, load balancers en CORS
- FHIR-clients kunnen meerdere tenants bedienen door alleen de base URL te wijzigen
- Compatibel met SMART on FHIR launch context (iss = tenant-specifieke URL)

**Nadelen:**
- Alle bestaande routes moeten geprefixt worden
- Absolute referenties bevatten tenant-prefix (maar dat is wenselijk voor isolatie)

### 1.2 Header-based (`X-Tenant-Id`)

**Voordelen:**
- Geen URL-wijzigingen nodig

**Nadelen:**
- Niet zichtbaar in browser, logs of links
- Niet FHIR-standaard; clients moeten custom header ondersteunen
- Problematisch met SMART on FHIR (iss kan geen tenant onderscheiden)

### 1.3 Database-per-tenant

**Voordelen:**
- **Maximale data-isolatie** — tenant A kan nooit data van tenant B zien
- Eenvoudige backup/restore per tenant
- GDPR/AVG-compliant: volledige verwijdering = database droppen
- Geen risico op vergeten tenant-filter in queries

**Nadelen:**
- Meer MongoDB connections nodig (connection pooling cruciaal)
- Mongoose `forRoot` is niet dynamisch; vereist custom connection management

### 1.4 Collection-per-tenant

**Nadelen:** MongoDB limiet op collecties (~24.000), geen echte isolatie, indexes per collectie.

### 1.5 Discriminator-based (gedeelde collectie + tenant veld)

**Nadelen:** Geen data-isolatie (bug = data leak), grotere indexes, moeilijk GDPR-compliant.

## 2. Aanbevolen aanpak: URL-based + database-per-tenant

Dit biedt maximale isolatie (vereist voor zorgsector / NEN 7510 / GDPR), transparante tenant-identificatie, eenvoudige tenant-offboarding (database droppen) en compatibiliteit met SMART on FHIR.

### URL-structuur

```
Huidige routes:       /fhir/:resourceType
Multi-tenant routes:  /t/:tenantId/fhir/:resourceType

Voorbeelden:
  POST /t/hospital-a/fhir/Patient
  GET  /t/hospital-a/fhir/Patient/123
  GET  /t/hospital-a/fhir/metadata
  GET  /t/hospital-a/fhir/$export

Tenant management (admin):
  GET    /admin/tenants
  POST   /admin/tenants
  GET    /admin/tenants/:id
  PUT    /admin/tenants/:id
  DELETE /admin/tenants/:id
  POST   /admin/tenants/:id/suspend
  POST   /admin/tenants/:id/activate
  POST   /admin/tenants/:id/purge
```

### Database-naamgeving

```
fhir_master           — tenant-registry, globale configuratie
fhir_tenant_{id}      — per-tenant database (bijv. fhir_tenant_hospital_a)
```

## 3. Bestandsstructuur

```
src/
  tenant/
    tenant.module.ts                    NestJS module voor tenant management
    tenant.controller.ts                CRUD API voor tenants (/admin/tenants)
    tenant.service.ts                   Tenant CRUD, provisioning, lifecycle
    tenant.schema.ts                    Mongoose schema voor tenant-registry
    tenant.guard.ts                     Guard: valideert tenantId, zet tenant op request
    tenant.middleware.ts                Middleware: extraheert tenantId uit URL, rewrite path
    tenant-connection.service.ts        Beheert dynamische Mongoose connections per tenant
    tenant-aware.decorator.ts           Parameter decorator: @TenantId()
    tenant.interfaces.ts                Interfaces: TenantInfo, TenantStatus
    tenant-database.provider.ts         Dynamic provider: injecteert tenant-specifiek Model
```

### Gewijzigde bestanden

```
  fhir/fhir.module.ts                  DynamicModule met tenant-aware providers
  fhir/fhir.service.ts                 @InjectModel → @Inject(TENANT_FHIR_MODEL)
  fhir/fhir.controller.ts              getBaseUrl() tenant-aware
  fhir/audit/audit-event.service.ts    tenant-aware Model injection
  fhir/subscriptions/subscription.service.ts   tenant-aware Model + event filtering
  fhir/bulk-export/bulk-export.service.ts      tenant-aware + job-isolatie
  fhir/guards/smart-auth.guard.ts      tenant-specifieke JWKS/issuer
  app.module.ts                        master DB + TenantModule import
```

## 4. Technische details

### 4.1 Tenant Resolution Middleware

```typescript
// src/tenant/tenant.middleware.ts
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const match = req.path.match(/^\/t\/([a-z0-9_-]+)\//i);
    if (match) {
      req['tenantId'] = match[1];
      // Rewrite path: /t/{tenantId}/fhir/... → /fhir/...
      // Bestaande @Controller('fhir') decorators hoeven NIET te veranderen
      req.url = req.url.replace(`/t/${match[1]}`, '');
    }
    next();
  }
}
```

Door URL-rewriting in de middleware hoeven bestaande controllers niet aangepast te worden qua routing.

### 4.2 Dynamic Database Connections

```typescript
// src/tenant/tenant-connection.service.ts
@Injectable()
export class TenantConnectionService implements OnModuleDestroy {
  private connections = new Map<string, Connection>();

  async getConnection(tenantId: string): Promise<Connection> {
    if (this.connections.has(tenantId)) return this.connections.get(tenantId);
    const uri = this.buildTenantUri(tenantId);  // .../fhir → .../fhir_tenant_{id}
    const conn = await createConnection(uri, { maxPoolSize: 10 });
    await this.ensureIndexes(conn);             // zelfde indexes als FhirResourceSchema
    this.connections.set(tenantId, conn);
    return conn;
  }

  async onModuleDestroy() {
    for (const conn of this.connections.values()) await conn.close();
  }
}
```

### 4.3 Request-Scoped Tenant Model Provider

De kern: een `REQUEST`-scoped provider die per request het juiste Mongoose Model teruggeeft.

```typescript
// src/tenant/tenant-database.provider.ts
export const TENANT_FHIR_MODEL = 'TENANT_FHIR_MODEL';

export const TenantFhirModelProvider = {
  provide: TENANT_FHIR_MODEL,
  scope: Scope.REQUEST,
  inject: [REQUEST, TenantConnectionService],
  useFactory: async (req: Request, connService: TenantConnectionService) => {
    const tenantId = req['tenantId'];
    if (!tenantId) throw new BadRequestException('Tenant ID is required');
    const conn = await connService.getConnection(tenantId);
    return conn.model(FhirResource.name, FhirResourceSchema, 'fhir_resources');
  },
};
```

### 4.4 FhirService aanpassing

```typescript
// Huidige code:
constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>)

// Nieuwe code:
constructor(@Inject(TENANT_FHIR_MODEL) private readonly resourceModel: Model<FhirResource>)
```

Omdat de provider REQUEST-scoped is, wordt FhirService automatisch ook request-scoped. Mongoose connections worden hergebruikt via `TenantConnectionService`.

### 4.5 Tenant Guard

```typescript
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenantService: TenantService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req['tenantId'];
    if (!tenantId) return true;  // Routes zonder tenant prefix (/health, /admin)
    const tenant = await this.tenantService.findById(tenantId);
    if (!tenant) throw new NotFoundException(`Tenant '${tenantId}' not found`);
    if (tenant.status !== 'active') throw new ForbiddenException(`Tenant '${tenantId}' is ${tenant.status}`);
    req['tenant'] = tenant;
    return true;
  }
}
```

### 4.6 getBaseUrl aanpassing

```typescript
private getBaseUrl(req: Request): string {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const tenantId = req['tenantId'];
  const prefix = tenantId ? `/t/${tenantId}` : '';
  return `${proto}://${host}${prefix}/fhir`;
}
```

Alle Bundle self-links, fullUrls, referenties en Location headers bevatten automatisch de tenant-prefix.

### 4.7 Tenant Schema

```typescript
@Schema({ timestamps: true, collection: 'tenants' })
export class Tenant extends Document {
  @Prop({ required: true, unique: true }) id: string;          // slug: "hospital-a"
  @Prop({ required: true }) name: string;
  @Prop({ default: 'active' }) status: string;                  // active | suspended | decommissioned
  @Prop({ type: Object }) config: {
    smartEnabled?: boolean;
    jwksUri?: string;
    issuer?: string;
    audience?: string;
    rateLimitOverride?: { ttl: number; limit: number };
  };
  @Prop() contactEmail: string;
}
```

## 5. Impact op bestaande features

| Feature | Impact | Toelichting |
|---------|--------|-------------|
| **Search** | LAAG | Model is al tenant-specifiek via provider. `QueryBuilderService` etc. moeten `@Inject(TENANT_FHIR_MODEL)` gebruiken. |
| **Subscriptions** | MIDDEL | `FhirResourceEvent` uitbreiden met `tenantId`. Alleen subscriptions uit dezelfde tenant evalueren. |
| **AuditEvent** | MIDDEL | Schrijven naar tenant-database. GDPR-wenselijk: audit trail bij tenant-data. |
| **Bulk Export** | MIDDEL | Job-isolatie per tenant. Export URLs bevatten tenant-prefix. |
| **SMART on FHIR** | HOOG | Elke tenant kan eigen JWKS/issuer/audience. `SmartAuthGuard` laadt tenant-specifieke config. `.well-known/smart-configuration` wordt tenant-specifiek. |
| **Rate Limiting** | LAAG | Optioneel per-tenant rate limits via tenant config. |
| **Bundle/Transaction** | LAAG | Indirect via FhirService, automatisch correct. |
| **Conformance Resources** | BESLISSING | Aanbeveling: gedeeld in master database. Standaard profielen zijn tenant-onafhankelijk. |

## 6. Tenant Lifecycle

```
provisioning → active → suspended → active (heractivering)
                    ↓
              decommissioned → purged (database gedropped)
```

### Provisioning (POST /admin/tenants)

1. Valideer tenant ID (slug: lowercase, alfanumeriek, max 50 chars)
2. Controleer uniciteit
3. Maak tenant document in master database
4. Maak tenant database: `fhir_tenant_{id}`
5. Maak indexes aan (kopieer uit `FhirResourceSchema`)
6. Seed conformance resources (CapabilityStatement, SearchParameters)
7. Zet status op `active`

### Offboarding

1. Zet status op `decommissioned`
2. Optioneel: bulk export voor data-overdracht
3. Na retentieperiode (standaard 90 dagen): `purge`
4. Purge = `db.dropDatabase()` + verwijder tenant document

## 7. Implementatiefasen

### Fase 1: Tenant Infrastructure (basis)
1. `src/tenant/` module met schema, service, interfaces
2. `TenantConnectionService` voor dynamische DB connections
3. `TenantMiddleware` (URL-rewriting)
4. `TenantGuard`
5. REQUEST-scoped Model providers
6. `AppModule` aanpassen
7. Unit tests

### Fase 2: Core FHIR tenant-awareness
1. `FhirService`: `@InjectModel` → `@Inject(TENANT_FHIR_MODEL)`
2. Alle services met `@InjectModel(FhirResource.name)` aanpassen
3. `FhirController.getBaseUrl()` tenant-aware
4. `FhirResourceEvent` uitbreiden met `tenantId`
5. E2e tests: CRUD met tenant prefix

### Fase 3: Tenant Management API
1. `TenantController` met CRUD endpoints
2. Provisioning logica (database + indexes)
3. Suspend/activate/decommission/purge
4. Admin authenticatie
5. E2e tests

### Fase 4: SMART on FHIR per tenant
1. `SmartAuthGuard` tenant-specifieke config
2. `.well-known/smart-configuration` tenant-aware
3. JWKs caching per tenant (met TTL)
4. Fallback naar globale SMART config

### Fase 5: Subscriptions en Audit tenant-awareness
1. Events voorzien van `tenantId`
2. `SubscriptionService`: filter per tenant
3. `AuditEventService`: schrijf naar tenant-database

### Fase 6: Bulk Export en operaties
1. Job-isolatie per tenant
2. `$expunge`, `$reindex`, `$diff`, `$meta`: tenant-aware

### Fase 7: Migratie-tooling en documentatie
1. Migratiescript: single-tenant data → tenant-database
2. Swagger documentatie updaten
3. README bijwerken

## 8. Configuratie

```bash
# Master database (tenant registry)
MONGODB_URI=mongodb://localhost:27017/fhir_master

# Connection pool per tenant
TENANT_MAX_POOL_SIZE=10

# Maximaal aantal tenants
TENANT_MAX_COUNT=100

# Offboarding retentieperiode (dagen)
TENANT_RETENTION_DAYS=90
```

## 9. Risico's en mitigaties

| Risico | Mitigatie |
|--------|-----------|
| Te veel open connections | Connection pooling + idle timeout + `TENANT_MAX_COUNT` |
| REQUEST-scoped services overhead | Connection caching (alleen Model per request, connection hergebruikt) |
| Cross-tenant data lekkage | Database-per-tenant elimineert dit structureel |
| Complexe migratie bestaande data | Migratiescript + dual-mode (fallback single-tenant) |
| Middleware URL-rewriting breekt routing | Uitgebreide e2e tests, feature branch |

## 10. Testing strategie

1. **Unit tests**: TenantMiddleware, TenantGuard, TenantConnectionService
2. **Integratie tests**: REQUEST-scoped Model provider met mongodb-memory-server
3. **E2e tests**: CRUD flow met meerdere tenants, verify isolatie
4. **Cross-tenant isolatie test**: Data in tenant A onzichtbaar in tenant B
5. **Lifecycle tests**: Provisioning → suspend → activate → decommission → purge
6. **Performance test**: Latency single-tenant vs multi-tenant
