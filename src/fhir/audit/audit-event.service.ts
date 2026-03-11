import {randomUUID} from 'crypto';
import {Injectable, Logger} from '@nestjs/common';
import {OnEvent} from '@nestjs/event-emitter';
import {InjectModel} from '@nestjs/mongoose';
import {Model} from 'mongoose';
import {FhirResource} from '../fhir-resource.schema';
import {FhirResourceEvent} from '../subscriptions/subscription.types';

const ACTION_TO_SUBTYPE: Record<string, { code: string; display: string }> = {
  create: {code: 'create', display: 'create'},
  update: {code: 'update', display: 'update'},
  delete: {code: 'delete', display: 'delete'},
};

const ACTION_TO_CODE: Record<string, string> = {create: 'C', update: 'U', delete: 'D'};

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
    // Prevent infinite recursion: don't audit AuditEvent changes
    if (event.resourceType === 'AuditEvent') {
return;
}

    try {
      const now = new Date().toISOString();
      const id = randomUUID();
      const subtype = ACTION_TO_SUBTYPE[event.action];

      const auditEvent: any = {
        resourceType: 'AuditEvent',
        id,
        meta: {versionId: '1', lastUpdated: now},
        type: {system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110112', display: 'Query'},
        subtype: subtype ? [{system: 'http://hl7.org/fhir/restful-interaction', code: subtype.code, display: subtype.display}] : [],
        action: ACTION_TO_CODE[event.action] || 'E',
        recorded: now,
        outcome: '0', // success
        agent: [this.buildAgent(event.req)],
        source: {observer: {display: 'fhir-api-server'}, type: [{system: 'http://terminology.hl7.org/CodeSystem/security-source-type', code: '4', display: 'Application Server'}]},
        entity: [{what: {reference: `${event.resourceType}/${event.id}`}, type: {system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type', code: '2', display: 'System Object'}}],
      };

      // Set correct type based on action
      if (event.action === 'create' || event.action === 'update' || event.action === 'delete') {
        auditEvent.type = {system: 'http://dicom.nema.org/resources/ontology/DCM', code: '110110', display: 'Patient Record'};
      }

      await new this.resourceModel(auditEvent).save();
      this.logger.debug(`AuditEvent created: ${event.action} ${event.resourceType}/${event.id}`);
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