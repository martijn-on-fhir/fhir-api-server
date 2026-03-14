import {BadRequestException, Injectable, Logger, NotFoundException} from '@nestjs/common';
import {InjectModel} from '@nestjs/mongoose';
import {IssueSeverity, IssueType, OperationOutcome, OperationOutcomeIssue} from 'fhir-models-r4';
import {Model} from 'mongoose';
import {CacheService} from '../../cache/cache.service';
import {ConformanceResource} from '../conformance-resource.schema';

const MAX_RECURSION_DEPTH = 5;

/**
 * Service for FHIR terminology operations: $expand (ValueSet), $lookup (CodeSystem), and $translate (ConceptMap).
 * Operates directly on conformance resources stored in MongoDB.
 */
@Injectable()
export class TerminologyService {

  private readonly logger = new Logger(TerminologyService.name);

  constructor(@InjectModel(ConformanceResource.name) private readonly model: Model<ConformanceResource>, private readonly cacheService: CacheService) {
  }

  /**
   * Expands a ValueSet by resolving compose.include rules or returning a pre-computed expansion.
   * Supports filtering by display/code, and pagination via offset/count.
   * @param params - Parameters including url, filter, offset, count, or a ValueSet resource for POST.
   * @param id - Optional logical id for instance-level invocation.
   * @returns A ValueSet resource with an expansion element.
   */
  async expand(params: { url?: string; filter?: string; offset?: string; count?: string; valueSet?: any }, id?: string): Promise<any> {
    let valueSet: any;

    if (params.valueSet) {
      valueSet = params.valueSet;
    } else {
      valueSet = await this.findValueSet(params.url, id);
    }

    let contains: any[];

    if (valueSet.expansion?.contains?.length) {
      contains = valueSet.expansion.contains;
    } else if (valueSet.compose?.include?.length) {
      contains = await this.resolveCompose(valueSet.compose.include, 0);
    } else {
      contains = [];
    }

    if (params.filter) {
      const filterLower = params.filter.toLowerCase();
      contains = contains.filter((c) => (c.display && c.display.toLowerCase().includes(filterLower)) || (c.code && c.code.toLowerCase().includes(filterLower)));
    }

    const total = contains.length;
    const offset = params.offset ? parseInt(params.offset, 10) : 0;
    const count = params.count ? parseInt(params.count, 10) : contains.length;
    const paged = contains.slice(offset, offset + count);

    const result = {...valueSet, expansion: {identifier: `urn:uuid:${Date.now()}`, timestamp: new Date().toISOString(), total, offset, contains: paged}};
    delete result._id;
    delete result.__v;
    delete result.compose;

    this.logger.log(`$expand: ${total} concepts (filter=${params.filter || 'none'}, offset=${offset}, count=${count})`);

    return result;
  }

  /**
   * Looks up a code in a CodeSystem and returns its properties as a FHIR Parameters resource.
   * Searches concept arrays recursively for hierarchical CodeSystems.
   * @param params - Parameters including system, code, version, and display.
   * @param id - Optional logical id for instance-level invocation.
   * @returns A FHIR Parameters resource with name, version, display, designation, and property parameters.
   */
  async lookup(params: { system?: string; code?: string; version?: string; display?: string }, id?: string): Promise<any> {
    if (!params.code) {
      throw new BadRequestException(this.operationOutcome('Parameter "code" is required', IssueType.Required));
    }

    const codeSystem = await this.findCodeSystem(params.system, id);
    const concept = this.findConceptInList(codeSystem.concept || [], params.code);

    if (!concept) {
      throw new NotFoundException(this.operationOutcome(`Code "${params.code}" not found in CodeSystem "${codeSystem.url || id}"`, IssueType.NotFound));
    }

    const parameters: any[] = [{name: 'name', valueString: codeSystem.name || codeSystem.title || codeSystem.url}, {name: 'display', valueString: concept.display || concept.code}];

    if (codeSystem.version) {
      parameters.push({name: 'version', valueString: codeSystem.version});
    }

    if (concept.designation?.length) {
      for (const d of concept.designation) {
        parameters.push({name: 'designation', part: [{name: 'value', valueString: d.value}, ...(d.language ? [{name: 'language', valueCode: d.language}] : []), ...(d.use ? [{name: 'use', valueCoding: d.use}] : [])]});
      }
    }

    if (concept.property?.length) {
      for (const p of concept.property) {
        const valuePart = this.propertyValueToPart(p);

        if (valuePart) {
          parameters.push({name: 'property', part: [{name: 'code', valueCode: p.code}, valuePart]});
        }
      }
    }

    this.logger.log(`$lookup: code=${params.code} in ${codeSystem.url || id}`);

    return {resourceType: 'Parameters', parameter: parameters};
  }

  /**
   * Translates a code from one system to another using a ConceptMap.
   * @param params - Parameters including url, system, code, source, and target.
   * @param id - Optional logical id for instance-level invocation.
   * @returns A FHIR Parameters resource with result (boolean) and match array.
   */
  async translate(params: { url?: string; system?: string; code?: string; source?: string; target?: string }, id?: string): Promise<any> {

    if (!params.code) {
      throw new BadRequestException(this.operationOutcome('Parameter "code" is required', IssueType.Required));
    }

    const conceptMap = await this.findConceptMap(params.url, params.source, params.target, id);
    const matches: any[] = [];

    for (const group of conceptMap.group || []) {
      if (params.system && group.source !== params.system) {
        continue;
      }

      for (const element of group.element || []) {
        if (element.code !== params.code) {
          continue;
        }

        for (const target of element.target || []) {
          matches.push({
            name: 'match', part: [{name: 'equivalence', valueCode: target.equivalence || 'equivalent'},
              {name: 'concept', valueCoding: {system: group.target, code: target.code, display: target.display}}]
          });
        }
      }
    }

    const parameters: any[] = [{name: 'result', valueBoolean: matches.length > 0}, ...matches];

    this.logger.log(`$translate: code=${params.code} system=${params.system || 'any'} → ${matches.length} matches`);

    return {resourceType: 'Parameters', parameter: parameters};
  }

  /**
   * Finds a ValueSet by canonical URL or logical id.
   */
  private async findValueSet(url?: string, id?: string): Promise<any> {

    if (!url && !id) {
      throw new BadRequestException(this.operationOutcome('Either "url" parameter or resource id is required', IssueType.Required));
    }

    const cacheKey = `terminology:ValueSet:${id || url}`;

    return this.cacheService.getOrSet(cacheKey, async () => {
      const filter: Record<string, any> = {resourceType: 'ValueSet'};

      if (id) {
filter.id = id;
} else {
filter.url = url;
}

      const resource = await this.model.findOne(filter).lean().exec();

      if (!resource) {
throw new NotFoundException(this.operationOutcome(`ValueSet not found: ${url || id}`, IssueType.NotFound));
}

      return resource;
    });
  }

  /**
   * Finds a CodeSystem by system URL or logical id.
   */
  private async findCodeSystem(system?: string, id?: string): Promise<any> {

    if (!system && !id) {
      throw new BadRequestException(this.operationOutcome('Either "system" parameter or resource id is required', IssueType.Required));
    }

    const cacheKey = `terminology:CodeSystem:${id || system}`;

    return this.cacheService.getOrSet(cacheKey, async () => {
      const filter: Record<string, any> = {resourceType: 'CodeSystem'};

      if (id) {
filter.id = id;
} else {
filter.url = system;
}

      const resource = await this.model.findOne(filter).lean().exec();

      if (!resource) {
throw new NotFoundException(this.operationOutcome(`CodeSystem not found: ${system || id}`, IssueType.NotFound));
}

      return resource;
    });
  }

  /**
   * Finds a ConceptMap by URL, source, target, or logical id.
   */
  private async findConceptMap(url?: string, source?: string, target?: string, id?: string): Promise<any> {

    if (!id && !url && !source && !target) {
      throw new BadRequestException(this.operationOutcome('Either "url", "source", "target" parameter or resource id is required', IssueType.Required));
    }

    const cacheKey = `terminology:ConceptMap:${id || url || ''}:${source || ''}:${target || ''}`;

    return this.cacheService.getOrSet(cacheKey, async () => {
      const filter: Record<string, any> = {resourceType: 'ConceptMap'};

      if (id) {
 filter.id = id; 
} else if (url) {
 filter.url = url; 
} else {
        if (source) {
filter.$or = [{sourceUri: source}, {sourceCanonical: source}];
}

        if (target) {
          if (filter.$or) {
 filter.$and = [{$or: filter.$or}, {$or: [{targetUri: target}, {targetCanonical: target}]}]; delete filter.$or; 
} else {
 filter.$or = [{targetUri: target}, {targetCanonical: target}]; 
}
        }
      }

      const resource = await this.model.findOne(filter).lean().exec();

      if (!resource) {
throw new NotFoundException(this.operationOutcome(`ConceptMap not found`, IssueType.NotFound));
}

      return resource;
    });
  }

  /**
   * Resolves compose.include rules into a flat list of concepts.
   */
  private async resolveCompose(includes: any[], depth: number): Promise<any[]> {

    if (depth >= MAX_RECURSION_DEPTH) {
      this.logger.warn('$expand: max recursion depth reached');

      return [];
    }

    const results: any[] = [];

    for (const include of includes) {
      if (include.concept?.length) {
        for (const c of include.concept) {
          results.push({system: include.system, code: c.code, display: c.display || c.code});
        }
      } else if (include.system) {
        const concepts = await this.resolveSystemInclude(include);
        results.push(...concepts);
      }

      if (include.valueSet?.length) {
        for (const vsUrl of include.valueSet) {
          const nested = await this.model.findOne({resourceType: 'ValueSet', url: vsUrl}).lean().exec();

          if (nested) {
            if ((nested as any).expansion?.contains?.length) {
              results.push(...(nested as any).expansion.contains);
            } else if ((nested as any).compose?.include?.length) {
              const expanded = await this.resolveCompose((nested as any).compose.include, depth + 1);
              results.push(...expanded);
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Resolves a compose.include with system + optional filter against a CodeSystem in MongoDB.
   */
  private async resolveSystemInclude(include: any): Promise<any[]> {
    const codeSystem = await this.model.findOne({resourceType: 'CodeSystem', url: include.system}).lean().exec() as any;

    if (!codeSystem?.concept?.length) {
      return [];
    }

    let concepts = this.flattenConcepts(codeSystem.concept, include.system);

    if (include.filter?.length) {
      for (const f of include.filter) {
        concepts = this.applyConceptFilter(concepts, f);
      }
    }

    return concepts;
  }

  /**
   * Flattens a hierarchical concept list into a flat array with system attached.
   */
  private flattenConcepts(concepts: any[], system: string): any[] {

    const result: any[] = [];

    for (const c of concepts) {
      result.push({system, code: c.code, display: c.display || c.code});

      if (c.concept?.length) {
        result.push(...this.flattenConcepts(c.concept, system));
      }
    }

    return result;
  }

  /**
   * Applies a compose.include.filter to a list of concepts.
   * Supports op "is-a" (hierarchical), "=" (exact), and "regex".
   */
  private applyConceptFilter(concepts: any[], filter: any): any[] {

    if (filter.op === '=' || filter.op === 'is-a') {
      return concepts.filter((c) => filter.property === 'concept' || filter.property === 'code' ? c.code === filter.value || c.display === filter.value : true);
    }

    if (filter.op === 'regex') {
      try {
        const safePattern = filter.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(safePattern, 'i');

        return concepts.filter((c) => regex.test(c.code) || regex.test(c.display || ''));
      } catch {
        return concepts;
      }
    }

    return concepts;
  }

  /**
   * Recursively searches a concept array for a code.
   */
  private findConceptInList(concepts: any[], code: string): any | null {

    for (const c of concepts) {
      if (c.code === code) {
        return c;
      }

      if (c.concept?.length) {
        const found = this.findConceptInList(c.concept, code);

        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  /**
   * Converts a CodeSystem concept property to a FHIR Parameters part.
   */
  private propertyValueToPart(property: any): any | null {

    if (property.valueCode !== undefined) {
      return {name: 'value', valueCode: property.valueCode};
    }

    if (property.valueString !== undefined) {
      return {name: 'value', valueString: property.valueString};
    }

    if (property.valueCoding !== undefined) {
      return {name: 'value', valueCoding: property.valueCoding};
    }

    if (property.valueInteger !== undefined) {
      return {name: 'value', valueInteger: property.valueInteger};
    }

    if (property.valueBoolean !== undefined) {
      return {name: 'value', valueBoolean: property.valueBoolean};
    }

    if (property.valueDateTime !== undefined) {
      return {name: 'value', valueDateTime: property.valueDateTime};
    }

    if (property.valueDecimal !== undefined) {
      return {name: 'value', valueDecimal: property.valueDecimal};
    }

    return null;
  }

  /**
   * Creates an OperationOutcome for error responses.
   */
  private operationOutcome(message: string, code: IssueType): OperationOutcome {
    return new OperationOutcome({issue: [new OperationOutcomeIssue({severity: IssueSeverity.Error, code, diagnostics: message})]});
  }
}
