/**
 * Stripe SDK access. The client is created on first use so the agent still starts without Stripe configured
 * (purchases then answer 503 instead of the whole server failing to boot).
 */

import Stripe from 'stripe';
import { config } from '../../config/index.js';

let client = null;
let clientKey = '';

export function isStripeConfigured() {
  return Boolean(config.stripe.secretKey);
}

/** @returns {import('stripe').Stripe} */
export function getStripe() {
  const key = config.stripe.secretKey;
  if (!key) {
    const err = new Error('Online payment is not configured (STRIPE_SECRET_KEY)');
    err.statusCode = 503;
    throw err;
  }
  if (!client || clientKey !== key) {
    client = new Stripe(key, { maxNetworkRetries: 2 });
    clientKey = key;
  }
  return client;
}
