import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Model } from 'mongoose';
import { CacheService } from '../../cache/cache.service';
import { config } from '../../config/app-config';
import { FhirResource } from '../fhir-resource.schema';
import { FHIR_RESOURCE_MODEL } from '../fhir.constants';
import { FhirResourceEvent } from '../subscriptions/subscription.types';

/** Consent policy cache TTL in ms. Configured via centralized config. Default 60 seconds. */
const CONSENT_CACHE_TTL = config.fhir.consentCacheTtlMs;

/** Parsed consent policy for a patient — flattened from active Consent resources. */
export interface ConsentPolicy {
  patientId: string;
  /** Resource types fully denied (provision.class codes). */
  deniedResourceTypes: string[];
  /** Specific resource references denied (provision.data, e.g. "Observation/abc"). */
  deniedResourceRefs: string[];
  /** Actor-specific denials: this actor cannot access these resource types. */
  actorDenials: { actorRef: string; resourceTypes: string[] }[];
  /** Purpose-specific denials: these purposes are denied for these resource types. */
  purposeDenials: { purpose: string; resourceTypes: string[] }[];
}

/** Result of consent evaluation. */
export interface ConsentDecision {
  denied: boolean;
  reason?: string;
}

/**
 * Evaluates FHIR R4 Consent resources to enforce patient-level data access restrictions.
 * Only processes active Consent resources with scope=patient-privacy and provision.type=deny.
 * Opt-in model: if no Consent exists, all access is allowed.
 */
@Injectable()
export class ConsentEnforcementService {

  private readonly logger = new Logger(ConsentEnforcementService.name);

  constructor(@Inject(FHIR_RESOURCE_MODEL) private readonly resourceModel: Model<FhirResource>, private readonly cache: CacheService) {}

  /** Get the consent policy for a patient (cached). */
  async getPolicy(patientId: string): Promise<ConsentPolicy> {
    return this.cache.getOrSet(`consent:policy:${patientId}`, () => this.loadPolicy(patientId), CONSENT_CACHE_TTL);
  }

  /** Evaluate whether access to a specific resource is denied by consent. */
  evaluateAccess(policy: ConsentPolicy, resourceType: string, resourceId?: string, actorRef?: string, purposeOfUse?: string): ConsentDecision {
    // Check specific resource denial
    if (resourceId && policy.deniedResourceRefs.includes(`${resourceType}/${resourceId}`)) {
      return { denied: true, reason: `Access to ${resourceType}/${resourceId} denied by patient consent directive` };
    }

    // Check full resource type denial
    if (policy.deniedResourceTypes.includes(resourceType)) {
      return { denied: true, reason: `Access to ${resourceType} resources denied by patient consent directive` };
    }

    // Check actor-specific denial
    if (actorRef) {
      const actorDenial = policy.actorDenials.find((d) => d.actorRef === actorRef);

      if (actorDenial && (actorDenial.resourceTypes.length === 0 || actorDenial.resourceTypes.includes(resourceType))) {
        return { denied: true, reason: `Access denied for actor ${actorRef} by patient consent directive` };
      }
    }

    // Check purpose-of-use denial
    if (purposeOfUse) {
      const purposeDenial = policy.purposeDenials.find((d) => d.purpose === purposeOfUse);

      if (purposeDenial && (purposeDenial.resourceTypes.length === 0 || purposeDenial.resourceTypes.includes(resourceType))) {
        return { denied: true, reason: `Access denied for purpose ${purposeOfUse} by patient consent directive` };
      }
    }

    return { denied: false };
  }

  /** Build a MongoDB exclusion filter for denied resources in search queries. Returns null if no restrictions apply. */
  buildSearchExclusion(policy: ConsentPolicy, resourceType: string, actorRef?: string, purposeOfUse?: string): Record<string, any> | null {
    // Full type denial — return impossible filter
    if (policy.deniedResourceTypes.includes(resourceType)) {
      return { _impossible: true };
    }

    // Actor-specific full type denial
    if (actorRef) {
      const actorDenial = policy.actorDenials.find((d) => d.actorRef === actorRef);

      if (actorDenial && (actorDenial.resourceTypes.length === 0 || actorDenial.resourceTypes.includes(resourceType))) {
        return { _impossible: true };
      }
    }

    // Purpose-specific full type denial
    if (purposeOfUse) {
      const purposeDenial = policy.purposeDenials.find((d) => d.purpose === purposeOfUse);

      if (purposeDenial && (purposeDenial.resourceTypes.length === 0 || purposeDenial.resourceTypes.includes(resourceType))) {
        return { _impossible: true };
      }
    }

    // Specific resource exclusions
    const deniedIds = policy.deniedResourceRefs.filter((ref) => ref.startsWith(`${resourceType}/`)).map((ref) => ref.split('/')[1]);

    if (deniedIds.length > 0) {
      if (deniedIds.length > 100) {
        this.logger.warn(`Consent for patient ${policy.patientId} denies ${deniedIds.length} specific ${resourceType} resources — large $nin filter`);
      }

      return { id: { $nin: deniedIds } };
    }

    return null;
  }

  /** Invalidate cached consent policy when a Consent resource changes. */
  @OnEvent('fhir.resource.changed')
  async handleConsentChange(event: FhirResourceEvent): Promise<void> {
    if (event.resourceType !== 'Consent') {
      return;
    }

    const patientRef = event.resource?.patient?.reference || event.resource?.patient?.reference;

    if (patientRef) {
      const patientId = patientRef.replace(/^(.*\/)?Patient\//, '');
      await this.cache.delete(`consent:policy:${patientId}`);
      this.logger.debug(`Invalidated consent policy cache for patient ${patientId}`);
    }
  }

  /** Load active patient-privacy Consent resources and parse deny provisions. */
  private async loadPolicy(patientId: string): Promise<ConsentPolicy> {
    const policy: ConsentPolicy = { patientId, deniedResourceTypes: [], deniedResourceRefs: [], actorDenials: [], purposeDenials: [] };
    const patientRef = `Patient/${patientId}`;

    const consents = await this.resourceModel.find({
      resourceType: 'Consent', status: 'active',
      'scope.coding.code': 'patient-privacy',
      $or: [{ 'patient.reference': patientRef }, { 'patient.reference': { $regex: `Patient/${patientId}$` } }],
    }).lean().exec();

    if (consents.length === 0) {
      return policy;
    }

    const now = new Date();

    for (const consent of consents) {
      const provisions = (consent as any).provision?.provision || [];
      const topLevel = (consent as any).provision;

      // Also check top-level provision if it has type=deny
      const allProvisions = topLevel?.type === 'deny' ? [topLevel, ...provisions] : provisions;

      for (const prov of allProvisions) {
        if (prov.type !== 'deny') {
          continue;
        }

        // Check provision period
        if (prov.period) {
          if (prov.period.start && new Date(prov.period.start) > now) {
            continue;
          }

          if (prov.period.end && new Date(prov.period.end) < now) {
            continue;
          }
        }

        // Extract denied resource types from provision.class
        const deniedTypes = (prov.class || []).map((c: any) => c.code).filter(Boolean);

        // Extract denied specific resources from provision.data
        const deniedRefs = (prov.data || []).map((d: any) => d.reference?.reference).filter(Boolean).map((ref: string) => ref.replace(/^.*\/(?=[A-Z])/, ''));

        // Extract actor references
        const actors = (prov.actor || []).map((a: any) => a.reference?.reference).filter(Boolean);

        // Extract purpose codes
        const purposes = (prov.purpose || []).map((p: any) => p.code).filter(Boolean);

        if (actors.length > 0) {
          // Actor-specific denial
          for (const actorRef of actors) {
            const existing = policy.actorDenials.find((d) => d.actorRef === actorRef);

            if (existing) {
              existing.resourceTypes.push(...deniedTypes);
            } else {
              policy.actorDenials.push({ actorRef, resourceTypes: [...deniedTypes] });
            }
          }
        } else if (purposes.length > 0) {
          // Purpose-specific denial
          for (const purpose of purposes) {
            const existing = policy.purposeDenials.find((d) => d.purpose === purpose);

            if (existing) {
              existing.resourceTypes.push(...deniedTypes);
            } else {
              policy.purposeDenials.push({ purpose, resourceTypes: [...deniedTypes] });
            }
          }
        } else {
          // General denial
          policy.deniedResourceTypes.push(...deniedTypes);
          policy.deniedResourceRefs.push(...deniedRefs);
        }
      }
    }

    return policy;
  }
}
