// Setup file for tenant isolation tests.
// Sets MULTI_TENANT_ENABLED before any modules are loaded.
process.env.MULTI_TENANT_ENABLED = 'true';
process.env.CACHE_STORE = 'memory';
