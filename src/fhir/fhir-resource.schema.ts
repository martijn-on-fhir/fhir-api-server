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
