import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { locations, users } from '@shared/schema';

// Initialize Stripe
const getStripeInstance = () => {
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_TEST_SECRET_KEY || '';
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2022-11-15' });
};

const stripe = getStripeInstance();

// Configuration
const webhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || null;
const ENABLE_SETUP_FEE = process.env.ENABLE_SETUP_FEE !== 'false';
const SETUP_FEE_PRICE_ID = process.env.STRIPE_SETUP_FEE_PRICE_ID || null;
const SETUP_FEE_AMOUNT = Number(process.env.STRIPE_SETUP_FEE_AMOUNT || 100);
const SETUP_FEE_LABEL = process.env.STRIPE_SETUP_FEE_LABEL || 'Device Setup Fee';

// Helper function to get or create Stripe customer
export const getOrCreateStripeCustomer = async (storeNumber) => {
  if (!stripe) throw new Error('Stripe not configured');
  
  // Get store information
  const store = await db.select().from(locations)
    .where(eq(locations.id, Number(storeNumber)))
    .limit(1);
    
  if (!store.length) {
    throw new Error('Store not found');
  }
  
  const storeData = store[0];
  
  // Check if customer already exists
  const existingCustomer = await db.select()
    .from(require('@shared/schema').stripeCustomers)
    .where(eq(require('@shared/schema').stripeCustomers.storeNumber, Number(storeNumber)))
    .limit(1);
    
  let customerId;
  if (existingCustomer.length) {
    customerId = existingCustomer[0].customerId;
    
    // Update customer info in Stripe
    try {
      await stripe.customers.update(customerId, {
        name: storeData.name,
        email: storeData.email,
        phone: storeData.phone,
        address: {
          line1: storeData.address,
          city: storeData.city,
          state: storeData.state,
          postal_code: storeData.postcode,
          country: 'US'
        },
        metadata: { 
          store_number: String(storeNumber),
          booking_slug: storeData.bookingSlug || ''
        }
      });
    } catch (error) {
      console.error('Failed to update Stripe customer:', error);
    }
  } else {
    // Create new customer
    const customer = await stripe.customers.create({
      name: storeData.name,
      email: storeData.email,
      phone: storeData.phone,
      address: {
        line1: storeData.address,
        city: storeData.city,
        state: storeData.state,
        postal_code: storeData.postcode,
        country: 'US'
      },
      metadata: { 
        store_number: String(storeNumber),
        booking_slug: storeData.bookingSlug || ''
      }
    });
    
    customerId = customer.id;
    
    // Save to database
    await db.insert(require('@shared/schema').stripeCustomers).values({
      userId: storeData.userId,
      customerId: customerId,
      storeNumber: Number(storeNumber)
    });
  }
  
  return customerId;
};

// Create subscription
export const createSubscription = async (storeNumber, planCode, interval = 'month') => {
  if (!stripe) throw new Error('Stripe not configured');
  
  const customerId = await getOrCreateStripeCustomer(storeNumber);
  
  // Get plan information
  const plan = await db.select()
    .from(require('@shared/schema').billingPlans)
    .where(eq(require('@shared/schema').billingPlans.code, planCode))
    .limit(1);
    
  if (!plan.length) {
    throw new Error('Plan not found');
  }
  
  let priceId = plan[0].stripePriceId;
  
  // Create price if not exists
  if (!priceId) {
    const product = await stripe.products.create({
      name: plan[0].name,
      description: plan[0].description
    });
    
    const price = await stripe.prices.create({
      unit_amount: Number(plan[0].priceCents),
      currency: 'usd',
      recurring: { interval: interval },
      product: product.id
    });
    
    priceId = price.id;
    
    // Update plan with new price ID
    await db.update(require('@shared/schema').billingPlans)
      .set({ stripePriceId: priceId })
      .where(eq(require('@shared/schema').billingPlans.code, planCode));
  }
  
  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent']
  });
  
  // Save subscription to database
  await db.insert(require('@shared/schema').stripeSubscriptions).values({
    customerId: customerId,
    subscriptionId: subscription.id,
    priceId: priceId,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    status: subscription.status,
    paymentMethodBrand: subscription.default_payment_method?.card?.brand || null,
    paymentMethodLast4: subscription.default_payment_method?.card?.last4 || null
  });
  
  // Also save to subscriptions table for compatibility
  await db.insert(require('@shared/schema').subscriptions).values({
    storeNumber: Number(storeNumber),
    planCode: planCode,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
    interval: interval,
    priceId: priceId,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
    paymentMethodBrand: subscription.default_payment_method?.card?.brand || null,
    paymentMethodLast4: subscription.default_payment_method?.card?.last4 || null
  });
  
  return {
    clientSecret: subscription?.latest_invoice?.payment_intent?.client_secret,
    subscriptionId: subscription.id
  };
};

// Cancel subscription
export const cancelSubscription = async (subscriptionId, atPeriodEnd = false) => {
  if (!stripe) throw new Error('Stripe not configured');
  
  let subscription;
  if (atPeriodEnd) {
    subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  } else {
    subscription = await stripe.subscriptions.cancel(subscriptionId);
  }
  
  // Update database
  await db.update(require('@shared/schema').stripeSubscriptions)
    .set({ 
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end
    })
    .where(eq(require('@shared/schema').stripeSubscriptions.subscriptionId, subscriptionId));
    
  await db.update(require('@shared/schema').subscriptions)
    .set({ 
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ? 1 : 0,
      currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null
    })
    .where(eq(require('@shared/schema').subscriptions.stripeSubscriptionId, subscriptionId));
  
  return {
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end
  };
};

// Get subscription status
export const getSubscriptionStatus = async (storeNumber) => {
  const subscription = await db.select()
    .from(require('@shared/schema').subscriptions)
    .where(eq(require('@shared/schema').subscriptions.storeNumber, Number(storeNumber)))
    .limit(1);
    
  if (!subscription.length) {
    return { active: false, status: 'none' };
  }
  
  const sub = subscription[0];
  return {
    active: sub.status === 'active' || sub.status === 'trialing',
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    planCode: sub.planCode,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === 1
  };
};

// Webhook handler
export const handleStripeWebhook = async (body, signature) => {
  if (!webhookSecret) {
    throw new Error('Webhook secret not configured');
  }
  
  const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  
  switch (event.type) {
    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      if (invoice.subscription) {
        await db.update(require('@shared/schema').stripeSubscriptions)
          .set({ status: 'active' })
          .where(eq(require('@shared/schema').stripeSubscriptions.subscriptionId, invoice.subscription));
      }
      break;
      
    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      if (failedInvoice.subscription) {
        await db.update(require('@shared/schema').stripeSubscriptions)
          .set({ status: 'past_due' })
          .where(eq(require('@shared/schema').stripeSubscriptions.subscriptionId, failedInvoice.subscription));
      }
      break;
      
    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      await db.update(require('@shared/schema').stripeSubscriptions)
        .set({ status: 'canceled' })
        .where(eq(require('@shared/schema').stripeSubscriptions.subscriptionId, deletedSubscription.id));
      break;
      
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  return { received: true };
};
