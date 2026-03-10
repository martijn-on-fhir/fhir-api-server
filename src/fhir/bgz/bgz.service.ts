import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { BGZ_QUERIES, BGZ_INCLUDE_PATHS } from './bgz.constants';

/**
 * Service for BgZ (Basisgegevensset Zorg) retrieval.
 * Queries all 26 zibs for a specific patient using targeted MongoDB queries per resource type,
 * then resolves referenced resources (Practitioner, Organization, Device, etc.) as includes.
 */
@Injectable()
export class BgzService {

  constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>) {}

  /** Retrieve the complete BgZ for a patient. Returns match resources and included references. */
  async getBgz(patientId: string): Promise<{ matches: any[]; includes: any[] }> {
    // 1. Fetch the Patient
    const patient = await this.resourceModel.findOne({ resourceType: 'Patient', id: patientId, 'meta.deleted': { $ne: true } }).lean().exec();
    if (!patient) throw new NotFoundException(`Patient/${patientId} not found`);

    const ref = `Patient/${patientId}`;

    // 2. Run all BgZ queries in parallel
    const queryResults = await Promise.all(BGZ_QUERIES.map(({ resourceType, refPaths }) => {
      const filter: Record<string, any> = { resourceType, 'meta.deleted': { $ne: true } };
      if (refPaths.length === 1) {
        filter[refPaths[0]] = ref;
      } else {
        filter.$or = refPaths.map((p) => ({ [p]: ref }));
      }
      return this.resourceModel.find(filter).lean().exec();
    }));

    const matches = [patient, ...queryResults.flat()].map(this.stripMongoFields);

    // 3. Extract include references from match resources
    const includeRefs = new Set<string>();
    for (const resource of matches) {
      const defs = BGZ_INCLUDE_PATHS.filter((d) => d.resourceType === resource.resourceType);
      for (const def of defs) {
        for (const path of def.paths) {
          this.extractRefs(resource, path.split('.'), includeRefs);
        }
      }
    }

    // 4. Remove refs already in matches
    const matchRefs = new Set(matches.map((r) => `${r.resourceType}/${r.id}`));
    const toFetch = [...includeRefs].filter((r) => !matchRefs.has(r) && /^[A-Z][a-zA-Z]+\/[a-f0-9-]+$/.test(r));

    // 5. Fetch include resources in one query
    let includes: any[] = [];
    if (toFetch.length > 0) {
      const orFilter = toFetch.map((r) => { const [rt, id] = r.split('/'); return { resourceType: rt, id }; });
      includes = (await this.resourceModel.find({ $or: orFilter, 'meta.deleted': { $ne: true } }).lean().exec()).map(this.stripMongoFields);
    }

    return { matches, includes };
  }

  /** Recursively extract reference strings from a resource at the given path segments. */
  private extractRefs(obj: any, pathSegments: string[], refs: Set<string>): void {
    if (!obj || typeof obj !== 'object' || pathSegments.length === 0) return;
    const [current, ...rest] = pathSegments;

    if (current === 'reference' && rest.length === 0 && typeof obj.reference === 'string') {
      refs.add(obj.reference);
      return;
    }

    const value = obj[current];
    if (Array.isArray(value)) {
      for (const item of value) this.extractRefs(item, rest, refs);
    } else if (value && typeof value === 'object') {
      this.extractRefs(value, rest, refs);
    }
  }

  private stripMongoFields(doc: any): any {
    const { _id, __v, ...rest } = doc;
    return rest;
  }
}
