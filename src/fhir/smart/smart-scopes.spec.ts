import { parseSmartScope, hasRequiredScope, resolveAction, extractScopes } from './smart-scopes';

describe('SMART Scopes', () => {
  describe('parseSmartScope', () => {
    it('should parse patient/Patient.read', () => {
      expect(parseSmartScope('patient/Patient.read')).toEqual({ context: 'patient', resourceType: 'Patient', permission: 'read' });
    });

    it('should parse system/*.write', () => {
      expect(parseSmartScope('system/*.write')).toEqual({ context: 'system', resourceType: '*', permission: 'write' });
    });

    it('should parse user/Observation.*', () => {
      expect(parseSmartScope('user/Observation.*')).toEqual({ context: 'user', resourceType: 'Observation', permission: '*' });
    });

    it('should return null for invalid scopes', () => {
      expect(parseSmartScope('openid')).toBeNull();
      expect(parseSmartScope('launch')).toBeNull();
      expect(parseSmartScope('fhirUser')).toBeNull();
      expect(parseSmartScope('')).toBeNull();
      expect(parseSmartScope('invalid/scope')).toBeNull();
    });
  });

  describe('resolveAction', () => {
    it('should resolve GET to read', () => {
      expect(resolveAction('GET', '/fhir/Patient')).toBe('read');
    });

    it('should resolve POST to write', () => {
      expect(resolveAction('POST', '/fhir/Patient')).toBe('write');
    });

    it('should resolve POST _search to read', () => {
      expect(resolveAction('POST', '/fhir/Patient/_search')).toBe('read');
    });

    it('should resolve POST $validate to read', () => {
      expect(resolveAction('POST', '/fhir/Patient/$validate')).toBe('read');
    });

    it('should resolve PUT to write', () => {
      expect(resolveAction('PUT', '/fhir/Patient/123')).toBe('write');
    });

    it('should resolve DELETE to write', () => {
      expect(resolveAction('DELETE', '/fhir/Patient/123')).toBe('write');
    });
  });

  describe('hasRequiredScope', () => {
    it('should match exact scope', () => {
      expect(hasRequiredScope(['patient/Patient.read'], 'Patient', 'read')).toBe(true);
    });

    it('should reject wrong permission', () => {
      expect(hasRequiredScope(['patient/Patient.read'], 'Patient', 'write')).toBe(false);
    });

    it('should reject wrong resource type', () => {
      expect(hasRequiredScope(['patient/Patient.read'], 'Observation', 'read')).toBe(false);
    });

    it('should match wildcard resource type', () => {
      expect(hasRequiredScope(['system/*.read'], 'Patient', 'read')).toBe(true);
      expect(hasRequiredScope(['system/*.read'], 'Observation', 'read')).toBe(true);
    });

    it('should match wildcard permission', () => {
      expect(hasRequiredScope(['patient/Patient.*'], 'Patient', 'read')).toBe(true);
      expect(hasRequiredScope(['patient/Patient.*'], 'Patient', 'write')).toBe(true);
    });

    it('should match with multiple scopes', () => {
      expect(hasRequiredScope(['openid', 'patient/Patient.read', 'patient/Observation.read'], 'Observation', 'read')).toBe(true);
    });

    it('should reject when no matching scope exists', () => {
      expect(hasRequiredScope(['openid', 'launch'], 'Patient', 'read')).toBe(false);
    });

    it('should handle empty scopes', () => {
      expect(hasRequiredScope([], 'Patient', 'read')).toBe(false);
    });
  });

  describe('extractScopes', () => {
    it('should extract space-separated string scopes', () => {
      expect(extractScopes({ scope: 'patient/Patient.read system/*.write' }, 'scope')).toEqual(['patient/Patient.read', 'system/*.write']);
    });

    it('should extract array scopes', () => {
      expect(extractScopes({ scope: ['patient/Patient.read', 'openid'] }, 'scope')).toEqual(['patient/Patient.read', 'openid']);
    });

    it('should return empty array when claim missing', () => {
      expect(extractScopes({}, 'scope')).toEqual([]);
    });

    it('should use custom claim name', () => {
      expect(extractScopes({ scp: 'patient/Patient.read' }, 'scp')).toEqual(['patient/Patient.read']);
    });
  });
});
