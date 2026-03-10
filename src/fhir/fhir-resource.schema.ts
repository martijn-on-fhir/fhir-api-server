import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Mongoose schema for storing any FHIR R4 resource.
 * Uses `strict: false` so all FHIR fields are persisted without explicit schema definitions.
 * All resource types share a single `fhir_resources` collection, distinguished by `resourceType`.
 */
@Schema({ timestamps: false, strict: false, collection: 'fhir_resources' })
export class FhirResource extends Document {
  /** FHIR resource type identifier, e.g. "Patient", "Observation". */
  @Prop({ required: true })
  resourceType: string;

  /** Server-assigned logical id (UUID). */
  @Prop({ required: true })
  id: string;

  /** FHIR resource metadata: version tracking, timestamps, profiles, tags and security labels. */
  @Prop({ type: Object, required: true })
  meta: {
    versionId: string;
    lastUpdated: string;
    profile?: string[];
    tag?: { system?: string; code?: string; display?: string }[];
    security?: { system?: string; code?: string; display?: string }[];
  };
}

/** Compiled Mongoose schema for FhirResource. */
export const FhirResourceSchema = SchemaFactory.createForClass(FhirResource);

FhirResourceSchema.index({ resourceType: 1, id: 1 }, { unique: true });

// --- Performance indexes for common FHIR search patterns ---

// Identifier search: Patient?identifier=system|value
FhirResourceSchema.index({ resourceType: 1, 'identifier.system': 1, 'identifier.value': 1 });

// Token search on code/coding: Observation?code=system|code, Condition?code=...
FhirResourceSchema.index({ resourceType: 1, 'code.coding.system': 1, 'code.coding.code': 1 });

// Reference search: Observation?subject=Patient/123, Condition?subject=...
FhirResourceSchema.index({ resourceType: 1, 'subject.reference': 1 });

// Patient search: Encounter?patient=Patient/123
FhirResourceSchema.index({ resourceType: 1, 'patient.reference': 1 });

// Date search: _lastUpdated, common date fields
FhirResourceSchema.index({ resourceType: 1, 'meta.lastUpdated': -1 });

// Status search: Observation?status=final, Encounter?status=...
FhirResourceSchema.index({ resourceType: 1, status: 1 });

// Name search: Patient?name=..., Practitioner?name=...
FhirResourceSchema.index({ resourceType: 1, 'name.family': 1 });
FhirResourceSchema.index({ resourceType: 1, 'name.given': 1 });

// Category search: Observation?category=..., Condition?category=...
FhirResourceSchema.index({ resourceType: 1, 'category.coding.system': 1, 'category.coding.code': 1 });

// Date fields: Observation?date=..., Encounter?date=...
FhirResourceSchema.index({ resourceType: 1, 'effectiveDateTime': -1 });
FhirResourceSchema.index({ resourceType: 1, 'period.start': -1 });

// Profile search: _profile=http://...
FhirResourceSchema.index({ 'meta.profile': 1 });

// Tag/security search: _tag, _security
FhirResourceSchema.index({ 'meta.tag.system': 1, 'meta.tag.code': 1 });
FhirResourceSchema.index({ 'meta.security.system': 1, 'meta.security.code': 1 });

// Performer/author references
FhirResourceSchema.index({ resourceType: 1, 'performer.reference': 1 });
FhirResourceSchema.index({ resourceType: 1, 'encounter.reference': 1 });
