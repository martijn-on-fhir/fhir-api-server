import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Mongoose schema for storing historical versions of FHIR resources.
 * Each create, update or delete produces a history entry capturing the resource snapshot at that point.
 */
@Schema({ timestamps: false, strict: false, collection: 'fhir_resource_history' })
export class FhirResourceHistory extends Document {
  @Prop({ required: true })
  resourceType: string;

  @Prop({ required: true })
  id: string;

  @Prop({ type: Object, required: true })
  meta: { versionId: string; lastUpdated: string; profile?: string[]; tag?: any[]; security?: any[] };

  /** The HTTP method that produced this history entry. */
  @Prop({ type: Object })
  request: { method: string; url: string };

  /** The HTTP response status for this history entry. */
  @Prop({ type: Object })
  response: { status: string; etag?: string; lastModified?: string };

  /** True if this entry represents a deleted resource (tombstone). */
  @Prop({ default: false })
  _deleted: boolean;
}

export const FhirResourceHistorySchema = SchemaFactory.createForClass(FhirResourceHistory);

FhirResourceHistorySchema.index({ resourceType: 1, id: 1, 'meta.versionId': 1 }, { unique: true });
FhirResourceHistorySchema.index({ resourceType: 1, 'meta.lastUpdated': -1 });
