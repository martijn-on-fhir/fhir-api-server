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

  /** Resource metadata containing version tracking and timestamps. */
  @Prop({ type: Object, required: true })
  meta: {
    /** Sequential version number, incremented on each update. */
    versionId: string;
    /** ISO 8601 timestamp of the last modification. */
    lastUpdated: string;
  };
}

/** Compiled Mongoose schema for FhirResource. */
export const FhirResourceSchema = SchemaFactory.createForClass(FhirResource);

FhirResourceSchema.index({ resourceType: 1, id: 1 }, { unique: true });
