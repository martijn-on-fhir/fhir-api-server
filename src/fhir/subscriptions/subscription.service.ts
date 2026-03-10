import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { QueryBuilderService } from '../search/query-builder.service';
import { SubscriptionNotificationService } from './subscription-notification.service';
import { FhirResourceEvent, parseCriteria } from './subscription.types';

/**
 * Evaluates active FHIR Subscriptions against resource change events.
 * Listens for 'fhir.resource.changed' events emitted by FhirService,
 * checks criteria match, and triggers notification delivery.
 */
@Injectable()
export class SubscriptionService {

  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(FhirResource.name) private readonly resourceModel: Model<FhirResource>,
    private readonly queryBuilder: QueryBuilderService,
    private readonly notificationService: SubscriptionNotificationService,
  ) {}

  /** Handles resource change events — evaluates all active subscriptions for matches. */
  @OnEvent('fhir.resource.changed', { async: true })
  async handleResourceChanged(event: FhirResourceEvent): Promise<void> {

    // When a Subscription is created/updated with status "requested", activate it
    if (event.resourceType === 'Subscription' && event.resource?.status === 'requested' && (event.action === 'create' || event.action === 'update')) {
      await this.activateSubscription(event.id);

      return;
    }

    try {
      const subscriptions = await this.resourceModel.find({ resourceType: 'Subscription', status: 'active' }).lean().exec();

      if (subscriptions.length === 0) {
return;
}

      for (const sub of subscriptions) {
        try {
          await this.evaluateSubscription(sub, event);
        } catch (err: any) {
          this.logger.error(`Error evaluating Subscription/${sub.id}: ${err.message}`);
          await this.updateSubscriptionStatus(sub.id, 'error', err.message);
        }
      }
    } catch (err: any) {
      this.logger.error(`Error loading subscriptions: ${err.message}`);
    }
  }

  /** Activates a subscription by changing status from 'requested' to 'active'. */
  private async activateSubscription(subscriptionId: string): Promise<void> {

    this.logger.log(`Activating Subscription/${subscriptionId}`);
    await this.updateSubscriptionStatus(subscriptionId, 'active');
  }

  /** Evaluates a single subscription against a resource event. */
  private async evaluateSubscription(subscription: any, event: FhirResourceEvent): Promise<void> {

    const parsed = parseCriteria(subscription.criteria);

    if (!parsed) {
return;
}

    // Resource type must match
    if (parsed.resourceType !== event.resourceType) {
return;
}

    // For deletes, only match if criteria has no search params (i.e. matches all of that type)
    if (event.action === 'delete') {
      if (Object.keys(parsed.searchParams).length === 0) {
        await this.notificationService.sendNotification(subscription, event);
      }

      return;
    }

    // If no search params, every resource of this type matches
    if (Object.keys(parsed.searchParams).length === 0) {
      await this.notificationService.sendNotification(subscription, event);

      return;
    }

    // Use QueryBuilderService to build a filter and check if the resource matches
    const filter = this.queryBuilder.buildFilter(event.resourceType, parsed.searchParams);
    // Add the specific resource id to narrow to just this resource
    filter.id = event.id;

    const match = await this.resourceModel.findOne(filter).lean().exec();

    if (match) {
      await this.notificationService.sendNotification(subscription, event);
    }
  }

  /** Updates a Subscription's status field (e.g. to 'error' or 'off'). */
  private async updateSubscriptionStatus(subscriptionId: string, status: string, error?: string): Promise<void> {

    const update: any = { status };

    if (error) {
update.error = error;
}

    await this.resourceModel.updateOne({ resourceType: 'Subscription', id: subscriptionId }, { $set: update }).exec();
  }
}
