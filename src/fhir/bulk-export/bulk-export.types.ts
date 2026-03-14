/** Types for FHIR Bulk Data Export (FHIR R4 $export operation). */

export type BulkExportStatus = 'accepted' | 'in-progress' | 'complete' | 'error' | 'cancelled';

export interface BulkExportOutput {
  type: string;
  url: string;
  count?: number;
}

export interface BulkExportJob {
  id: string;
  status: BulkExportStatus;
  transactionTime: string;
  request: string;
  requiresAccessToken: boolean;
  /** Filter by resource types (_type parameter). */
  types?: string[];
  /** Filter by _since parameter. */
  since?: string;
  /** For group-level export. */
  groupId?: string;
  /** Legacy: completed NDJSON data keyed by resourceType (inline in job document). */
  output: Record<string, string>;
  /** Resource counts per type. */
  outputCounts: Record<string, number>;
  /** GridFS filenames keyed by resourceType. */
  gridfsFiles: Record<string, string>;
  /** Error entries. */
  errors: { type: string; url: string }[];
  /** Percentage 0-100. */
  progress: number;
  createdAt: Date;
  completedAt?: Date;
}
