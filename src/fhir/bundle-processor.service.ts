import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { OperationOutcome, OperationOutcomeIssue, IssueSeverity, IssueType } from 'fhir-models-r4';
import { Connection } from 'mongoose';
import { config } from '../config/app-config';
import { FhirService } from './fhir.service';
import { FhirValidationPipe } from './validation/fhir-validation.pipe';

/** Maximum allowed entries in a batch or transaction Bundle. Configured via centralized config. */
const MAX_BUNDLE_ENTRIES = config.fhir.maxBundleEntries;

/**
 * Processes FHIR Bundle resources of type batch and transaction.
 * - Batch: each entry processed independently, failures don't affect other entries.
 * - Transaction: all-or-nothing with MongoDB session, urn:uuid references resolved.
 */
@Injectable()
export class BundleProcessorService {

  private readonly logger = new Logger(BundleProcessorService.name);

  constructor(private readonly fhirService: FhirService, private readonly validationPipe: FhirValidationPipe, @InjectConnection() private readonly connection: Connection) {}

  /** Process a Bundle of type batch or transaction. Returns a response Bundle. */
  async process(bundle: any, baseUrl: string): Promise<any> {

    if (!bundle || bundle.resourceType !== 'Bundle') {
      throw new BadRequestException(this.createOutcome('Request body must be a Bundle resource'));
    }

    const entryCount = Array.isArray(bundle.entry) ? bundle.entry.length : 0;

    if (entryCount > MAX_BUNDLE_ENTRIES) {
      throw new BadRequestException(this.createOutcome(`Bundle contains ${entryCount} entries, which exceeds the maximum of ${MAX_BUNDLE_ENTRIES}`));
    }

    if (bundle.type === 'transaction') {
      return this.processTransaction(bundle, baseUrl);
    }

    if (bundle.type === 'batch') {
      return this.processBatch(bundle, baseUrl);
    }

    throw new BadRequestException(this.createOutcome(`Unsupported Bundle type: ${bundle.type}. Expected 'batch' or 'transaction'.`));
  }

  /** Batch: process each entry independently, collect results. */
  private async processBatch(bundle: any, baseUrl: string): Promise<any> {

    const entries = bundle.entry || [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      try {
        const result = await this.processEntry(entry, baseUrl);
        responseEntries.push(result);
      } catch (error: any) {
        responseEntries.push(this.errorEntry(error));
      }
    }

    return { resourceType: 'Bundle', type: 'batch-response', entry: responseEntries };
  }

  /** Transaction: all-or-nothing processing with urn:uuid resolution. Uses MongoDB transactions when replica set is available. */
  private async processTransaction(bundle: any, baseUrl: string): Promise<any> {

    const entries = bundle.entry || [];
    const uuidMap = new Map<string, string>();

    // FHIR spec ordering: DELETE → POST → PUT/PATCH → GET
    const deleteEntries = entries.filter((e: any) => e.request?.method === 'DELETE');
    const postEntries = entries.filter((e: any) => e.request?.method === 'POST');
    const putEntries = entries.filter((e: any) => e.request?.method === 'PUT');
    const getEntries = entries.filter((e: any) => e.request?.method === 'GET');
    const ordered = [...deleteEntries, ...postEntries, ...putEntries, ...getEntries];

    // Try to use a MongoDB transaction (requires replica set). Fall back to sequential processing if unavailable.
    const session = await this.connection.startSession();

    try {
      let responseEntries: any[] = [];

      await session.withTransaction(async () => {
        responseEntries = [];
        uuidMap.clear();

        for (const entry of ordered) {
          if (entry.resource) {
 entry.resource = this.resolveUuidReferences(entry.resource, uuidMap); 
}

          if (entry.request?.url) {
 entry.request.url = this.resolveUuidInUrl(entry.request.url, uuidMap); 
}

          const result = await this.processEntry(entry, baseUrl, session);
          responseEntries.push(result);

          if (entry.request?.method === 'POST' && entry.fullUrl?.startsWith('urn:uuid:') && result.resource) {
            uuidMap.set(entry.fullUrl, `${result.resource.resourceType}/${result.resource.id}`);
          }
        }
      });

      return { resourceType: 'Bundle', type: 'transaction-response', entry: responseEntries };
    } catch (err: any) {
      // If transactions are not supported (standalone MongoDB), fall back to sequential processing
      if (err.codeName === 'NotAReplicaSet' || err.code === 263 || err.message?.includes('replica set')) {
        this.logger.warn('MongoDB transactions unavailable (no replica set), processing transaction entries sequentially without atomicity');
        await session.endSession();

        return this.processTransactionSequential(ordered, uuidMap, baseUrl);
      }

      throw err;
    } finally {
      if (session.inTransaction()) {
 await session.abortTransaction(); 
}

      await session.endSession();
    }
  }

  /** Fallback: process transaction entries sequentially without atomicity (standalone MongoDB). */
  private async processTransactionSequential(ordered: any[], uuidMap: Map<string, string>, baseUrl: string): Promise<any> {
    const responseEntries: any[] = [];

    for (const entry of ordered) {
      if (entry.resource) {
 entry.resource = this.resolveUuidReferences(entry.resource, uuidMap); 
}

      if (entry.request?.url) {
 entry.request.url = this.resolveUuidInUrl(entry.request.url, uuidMap); 
}

      const result = await this.processEntry(entry, baseUrl);
      responseEntries.push(result);

      if (entry.request?.method === 'POST' && entry.fullUrl?.startsWith('urn:uuid:') && result.resource) {
        uuidMap.set(entry.fullUrl, `${result.resource.resourceType}/${result.resource.id}`);
      }
    }

    return { resourceType: 'Bundle', type: 'transaction-response', entry: responseEntries };
  }

  /** Process a single Bundle entry based on its request method. */
  private async processEntry(entry: any, baseUrl: string, session?: any): Promise<any> {

    const req = entry.request;

    if (!req?.method || !req?.url) {
      throw new BadRequestException(this.createOutcome('Bundle entry must have request.method and request.url'));
    }

    const { resourceType, id, searchParams } = this.parseRequestUrl(req.url);

    switch (req.method) {
      case 'POST': {
        if (entry.resource) {
await this.validationPipe.transform(entry.resource);
}

        const resource = await this.fhirService.create(resourceType, entry.resource || {}, session);
        const plain = resource.toObject ? resource.toObject() : resource;
        const { _id, __v, ...fhir } = plain;

        return { resource: fhir, response: { status: '201 Created', location: `${baseUrl}/${resourceType}/${fhir.id}`, etag: `W/"${fhir.meta.versionId}"`, lastModified: fhir.meta.lastUpdated } };
      }

      case 'PUT': {
        if (entry.resource) {
await this.validationPipe.transform(entry.resource);
}

        if (id) {
          const resource = await this.fhirService.update(resourceType, id, entry.resource || {}, session);
          const plain = resource.toObject ? resource.toObject() : resource;
          const { _id, __v, ...fhir } = plain;

          return { resource: fhir, response: { status: '200 OK', etag: `W/"${fhir.meta.versionId}"`, lastModified: fhir.meta.lastUpdated } };
        }

        // Conditional update
        const { resource: condResource, created } = await this.fhirService.conditionalUpdate(resourceType, entry.resource || {}, { ...searchParams, resourceType }, session);
        const condPlain = condResource.toObject ? condResource.toObject() : condResource;
        const { _id: _cid, __v: _cv, ...condFhir } = condPlain;

        return { resource: condFhir, response: { status: created ? '201 Created' : '200 OK', etag: `W/"${condFhir.meta.versionId}"`, lastModified: condFhir.meta.lastUpdated } };
      }

      case 'DELETE': {
        if (id) {
          await this.fhirService.delete(resourceType, id, session);

          return { response: { status: '204 No Content' } };
        }

        // Conditional delete
        const count = await this.fhirService.conditionalDelete(resourceType, { ...searchParams, resourceType }, session);

        return { response: { status: '200 OK' }, resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'information', code: 'informational', diagnostics: `Deleted ${count} resource(s)` }] } };
      }

      case 'GET': {
        if (id) {
          const resource = await this.fhirService.findById(resourceType, id);
          const plain = resource.toObject ? resource.toObject() : resource;
          const { _id, __v, ...fhir } = plain;

          return { resource: fhir, response: { status: '200 OK', etag: `W/"${fhir.meta.versionId}"` } };
        }

        // Search
        const { resources, total } = await this.fhirService.search(resourceType, searchParams);
        const searchBundle = { resourceType: 'Bundle', type: 'searchset', total, entry: resources.map((r: any) => {
 const o = r.toObject ? r.toObject() : r; const { _id, __v, ...f } = o;

 return { resource: f }; 
}) };

        return { resource: searchBundle, response: { status: '200 OK' } };
      }

      default:
        throw new BadRequestException(this.createOutcome(`Unsupported HTTP method: ${req.method}`));
    }
  }

  /** Parse a FHIR request URL like "Patient/123" or "Patient?name=test" into components. */
  private parseRequestUrl(url: string): { resourceType: string; id?: string; searchParams: Record<string, string> } {

    const [pathPart, queryPart] = url.split('?');
    const segments = pathPart.split('/').filter(Boolean);
    const resourceType = segments[0];
    const id = segments.length > 1 ? segments[1] : undefined;

    const searchParams: Record<string, string> = {};

    if (queryPart) {
      for (const part of queryPart.split('&')) {
        const [key, ...valueParts] = part.split('=');

        if (key) {
searchParams[decodeURIComponent(key)] = decodeURIComponent(valueParts.join('='));
}
      }
    }

    return { resourceType, id, searchParams };
  }

  /** Recursively replace urn:uuid:xxx references in a resource with actual references from the map. */
  private resolveUuidReferences(obj: any, uuidMap: Map<string, string>): any {

    if (obj === null || obj === undefined) {
return obj;
}

    if (typeof obj === 'string') {
      // Replace urn:uuid:xxx with the mapped reference
      if (obj.startsWith('urn:uuid:') && uuidMap.has(obj)) {
return uuidMap.get(obj);
}

      return obj;
    }

    if (Array.isArray(obj)) {
return obj.map((item) => this.resolveUuidReferences(item, uuidMap));
}

    if (typeof obj === 'object') {
      const resolved: any = {};

      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveUuidReferences(value, uuidMap);
      }

      return resolved;
    }

    return obj;
  }

  /** Replace urn:uuid references in a URL string. */
  private resolveUuidInUrl(url: string, uuidMap: Map<string, string>): string {

    for (const [urn, ref] of uuidMap) {
      url = url.replace(urn, ref);
    }

    return url;
  }

  /** Creates a response entry for a failed batch entry. */
  private errorEntry(error: any): any {

    const status = error.status || error.getStatus?.() || 500;
    const message = error.response?.issue?.[0]?.diagnostics || error.message || 'Internal server error';

    return {
      response: { status: `${status}` },
      resource: { resourceType: 'OperationOutcome', issue: [{ severity: 'error', code: 'exception', diagnostics: message }] },
    };
  }

  private createOutcome(diagnostics: string): OperationOutcome {
    return new OperationOutcome({ issue: [new OperationOutcomeIssue({ severity: IssueSeverity.Error, code: IssueType.Invalid, diagnostics })] });
  }
}
