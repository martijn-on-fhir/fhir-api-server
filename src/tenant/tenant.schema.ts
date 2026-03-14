import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { TenantConfig, TenantStatus } from './tenant.interfaces';

/**
 * Mongoose schema for tenant registration records.
 * Stored in the master/default database in the `tenants` collection.
 */
@Schema({ timestamps: true, collection: 'tenants' })
export class Tenant extends Document {
  /** Unique tenant identifier in hex-dash format, e.g. '6edb-752-09a51b-4'. */
  @Prop({ required: true, unique: true })
  id: string;

  /** Human-readable tenant name. */
  @Prop({ required: true })
  name: string;

  /** Lifecycle status of the tenant. */
  @Prop({ required: true, default: 'active' })
  status: TenantStatus;

  /** Optional contact email for the tenant administrator. */
  @Prop()
  contactEmail?: string;

  /** Optional per-tenant configuration overrides. */
  @Prop({ type: Object })
  config?: TenantConfig;

  /** Timestamp managed by Mongoose `timestamps: true`. */
  createdAt: Date;

  /** Timestamp managed by Mongoose `timestamps: true`. */
  updatedAt: Date;
}

/** Compiled Mongoose schema for Tenant. */
export const TenantSchema = SchemaFactory.createForClass(Tenant);
