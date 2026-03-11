import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: false, strict: false, collection: 'conformance_resources' })
export class ConformanceResource extends Document {
  @Prop({ required: true })
  resourceType: string;

  @Prop({ required: true })
  id: string;

  @Prop({ type: Object, required: true })
  meta: { versionId: string; lastUpdated: string; profile?: string[]; tag?: { system?: string; code?: string; display?: string }[] };

  /** Canonical URL — unique identifier for conformance resources. */
  @Prop()
  url: string;

  /** Version of this conformance resource (e.g. "4.0.1"). */
  @Prop()
  version: string;

  @Prop()
  name: string;

  @Prop()
  status: string;
}

export const ConformanceResourceSchema = SchemaFactory.createForClass(ConformanceResource);

ConformanceResourceSchema.index({ resourceType: 1, id: 1 }, { unique: true });
ConformanceResourceSchema.index({ resourceType: 1, url: 1, version: 1 }, { unique: true, sparse: true });
ConformanceResourceSchema.index({ resourceType: 1, name: 1 });
ConformanceResourceSchema.index({ resourceType: 1, status: 1 });