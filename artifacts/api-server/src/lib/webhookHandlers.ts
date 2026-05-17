import { getStripeSync } from "./stripeClient";
import { db, websitesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Received type: " +
          typeof payload +
          ". " +
          "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // Post-processing: deactivate or lapse custom domain on subscription events
    try {
      const event = JSON.parse(payload.toString()) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      const type = event.type;
      const obj = (event.data?.object ?? {}) as Record<string, unknown>;
      const status = String(obj.status ?? "");
      const metadata = (obj.metadata ?? {}) as Record<string, string>;
      const websiteId = metadata.websiteId ? parseInt(metadata.websiteId) : null;

      const isCancel =
        type === "customer.subscription.deleted" ||
        (type === "customer.subscription.updated" &&
          ["canceled", "unpaid"].includes(status));
      const isPaymentFailed = type === "invoice.payment_failed";

      if (websiteId && !isNaN(websiteId) && (isCancel || isPaymentFailed)) {
        await db
          .update(websitesTable)
          .set({
            customDomainStatus: isPaymentFailed ? "pending_payment" : null,
            ...(isCancel ? { customDomainToken: null } : {}),
          })
          .where(eq(websitesTable.id, websiteId));
      }
    } catch {
      // Non-fatal — stripe-replit-sync already processed successfully above
    }
  }
}
