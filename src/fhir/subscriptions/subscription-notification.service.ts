import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Model } from 'mongoose';
import { FhirResource } from '../fhir-resource.schema';
import { FHIR_RESOURCE_MODEL } from '../fhir.constants';
import { FhirResourceEvent } from './subscription.types';

/** Maximum number of delivery attempts before marking the subscription as error. */
const MAX_RETRIES = 3;
/** Base delay in ms for exponential backoff between retries. */
const BASE_DELAY_MS = 1000;

/**
 * Delivers FHIR Subscription notifications via rest-hook (HTTP POST).
 * Supports retry with exponential backoff and updates subscription status on failure.
 */
@Injectable()
export class SubscriptionNotificationService implements OnModuleDestroy {

  private readonly logger = new Logger(SubscriptionNotificationService.name);
  /** Tracks in-flight delivery promises so graceful shutdown can await them. */
  private readonly activeDeliveries = new Set<Promise<void>>();

  constructor(@Inject(FHIR_RESOURCE_MODEL) private readonly resourceModel: Model<FhirResource>) {}

  /** Waits for all in-flight subscription deliveries to complete before shutdown. */
  async onModuleDestroy(): Promise<void> {
    if (this.activeDeliveries.size > 0) {
      this.logger.log(`Waiting for ${this.activeDeliveries.size} active subscription deliveries to complete...`);
      await Promise.allSettled([...this.activeDeliveries]);
    }
  }

  /** Sends a notification for a matched subscription. Retries on failure. Tracked for graceful shutdown. */
  async sendNotification(subscription: any, event: FhirResourceEvent): Promise<void> {
    const promise = this.doSendNotification(subscription, event);
    this.activeDeliveries.add(promise);
    promise.finally(() => this.activeDeliveries.delete(promise));

    return promise;
  }

  /** Internal delivery logic with retries and exponential backoff. */
  private async doSendNotification(subscription: any, event: FhirResourceEvent): Promise<void> {

    const channel = subscription.channel;

    if (!channel || channel.type !== 'rest-hook') {
      this.logger.debug(`Subscription/${subscription.id} has unsupported channel type '${channel?.type}', skipping`);

      return;
    }

    const endpoint = channel.endpoint;

    if (!endpoint) {
      this.logger.warn(`Subscription/${subscription.id} has no endpoint, skipping`);

      return;
    }

    const payload = this.buildPayload(subscription, event);
    const headers: Record<string, string> = { 'Content-Type': channel.payload || 'application/fhir+json' };

    // Add custom headers from channel.header (FHIR R4: array of "Header: value" strings)
    if (Array.isArray(channel.header)) {
      for (const h of channel.header) {
        const colonIdx = h.indexOf(':');

        if (colonIdx > 0) {
          headers[h.substring(0, colonIdx).trim()] = h.substring(colonIdx + 1).trim();
        }
      }
    }

    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });

        if (response.ok) {
          this.logger.log(`Subscription/${subscription.id} → ${endpoint} delivered (${response.status})`);

          return;
        }

        lastError = `HTTP ${response.status} ${response.statusText}`;
        this.logger.warn(`Subscription/${subscription.id} → ${endpoint} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);
      } catch (err: any) {
        lastError = err.message || 'Unknown error';
        this.logger.warn(`Subscription/${subscription.id} → ${endpoint} attempt ${attempt}/${MAX_RETRIES} error: ${lastError}`);
      }

      if (attempt < MAX_RETRIES) {
        await this.delay(BASE_DELAY_MS * Math.pow(2, attempt - 1));
      }
    }

    // All retries exhausted — mark subscription as error
    this.logger.error(`Subscription/${subscription.id} delivery failed after ${MAX_RETRIES} attempts: ${lastError}`);
    await this.resourceModel.updateOne({ resourceType: 'Subscription', id: subscription.id }, { $set: { status: 'error', error: `Delivery failed: ${lastError}` } }).exec();
  }

  /** Builds the notification payload based on the subscription's channel.payload setting. */
  private buildPayload(subscription: any, event: FhirResourceEvent): any {

    const contentType = subscription.channel?.payload;

    const method = event.action === 'create' ? 'POST' : event.action === 'update' ? 'PUT' : 'DELETE';
    const entryRequest = { method, url: `${event.resourceType}/${event.id}` };

    // If payload is empty or 'application/fhir+json', send the full resource in a Bundle
    if (!contentType || contentType === 'application/fhir+json') {
      const entry: any = { request: entryRequest };

      if (event.resource) {
entry.resource = event.resource;
}

      return { resourceType: 'Bundle', type: 'history', entry: [entry] };
    }

    // For other payload types, send just the reference (id-only)
    return { resourceType: 'Bundle', type: 'history', entry: [{ request: entryRequest }] };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
