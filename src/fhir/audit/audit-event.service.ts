import {randomUUID} from 'crypto';
import {Injectable, Logger} from '@nestjs/common';
import {OnEvent} from '@nestjs/event-emitter';
import {InjectModel} from '@nestjs/mongoose';
import {Model} from 'mongoose';
import {FhirResource} from '../fhir-resource.schema';
import {FhirResourceEvent} from '../subscriptions/subscription.types';

const ACTION_TO_SUBTYPE: Record<string, { code: string; display: string }> = {
  create: {code: 'create', display: 'create'},
  read: {code: 'read', display: 'read'},
  vread: {code: 'vread', display: 'vread'},
  update: {code: 'update', display: 'update'},
  delete: {code: 'delete', display: 'delete'},
  search: {code: 'search-type', display: 'search-type'},
};

const ACTION_TO_CODE: Record<string, string> = {create: 'C', read: 'R', vread: 'R', search: 'R', update: 'U', delete: 'D'};

/**
 * Listens for fhir.resource.changed events and persists FHIR AuditEvent resources.
 * Writes directly to MongoDB to avoid recursion through FhirService.
 */
@Injectable()
export class AuditEventService {

  private readonly logger = new Logger(AuditEventService.name);

  constructor(@InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>) {}

  @OnEvent('fhir.resource.changed')
  async handleResourceChanged(event: FhirResourceEvent & { req?: any }) {
    if (event.resourceType === 'AuditEvent') {
return;
}

    await this.recordAudit(event.action, event.resourceType, event.id, event.req);
  }

  /** Record an AuditEvent for any FHIR interaction (read, search, create, update, delete). */
  async recordAudit(action: string, resourceType: string, resourceId: string | null, req?: any) {
    if (resourceType === 'AuditEvent') {
return;
}

    try {
      const now = new Date().toISOString();
      const subtype = ACTION_TO_SUBTYPE[action];
      const isQuery = action === 'search';
      const typeCode = isQuery ? '110112' : '110110';
      const typeDisplay = isQuery ? 'Query' : 'Patient Record';

      const auditEvent: any = {
        resourceType: 'AuditEvent', id: randomUUID(), meta: {versionId: '1', lastUpdated: now},
        type: {system: 'http://dicom.nema.org/resources/ontology/DCM', code: typeCode, display: typeDisplay},
        subtype: subtype ? [{system: 'http://hl7.org/fhir/restful-interaction', code: subtype.code, display: subtype.display}] : [],
        action: ACTION_TO_CODE[action] || 'E', recorded: now, outcome: '0',
        agent: [this.buildAgent(req)],
        source: {observer: {display: 'fhir-api-server'}, type: [{system: 'http://terminology.hl7.org/CodeSystem/security-source-type', code: '4', display: 'Application Server'}]},
      };

      // Entity: reference to the resource or resource type for searches
      if (resourceId) {
        auditEvent.entity = [{what: {reference: `${resourceType}/${resourceId}`}, type: {system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type', code: '2', display: 'System Object'}}];
      } else {
        auditEvent.entity = [{what: {display: resourceType}, type: {system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type', code: '2', display: 'System Object'}, description: req?.originalUrl}];
      }

      await new this.resourceModel(auditEvent).save();
      this.logger.debug(`AuditEvent created: ${action} ${resourceType}${resourceId ? '/' + resourceId : ''}`);
    } catch (err) {
      this.logger.error(`Failed to create AuditEvent: ${err.message}`);
    }
  }

  private buildAgent(req?: any): any {
    const agent: any = {requestor: true};

    // Extract user info from SMART JWT if available
    if (req?.user) {
      const user = req.user;
      agent.who = {display: user.sub || 'unknown'};

      if (user.iss) {
agent.who.identifier = {system: user.iss, value: user.sub};
}

      agent.name = user.name || user.sub;
    } else {
      agent.who = {display: 'anonymous'};
    }

    // Client IP and user-agent
    if (req) {
      if (req.ip || req.socket?.remoteAddress) {
agent.network = {address: req.ip || req.socket.remoteAddress, type: '2'};
}

      const userAgent = req.get?.('user-agent');

      if (userAgent) {
agent.policy = [userAgent];
}
    }

    return agent;
  }
}