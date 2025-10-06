// services/stripe.js
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Process payment using Stripe Shared Payment Token from ChatGPT
 * @param {string} sharedPaymentToken - Token from ChatGPT
 * @param {number} amount - Amount in cents
 * @param {string} currency - Currency code (USD, EUR, etc.)
 * @param {string} checkoutId - Your internal checkout ID
 * @returns {Object} Payment result
 */
async function processPayment(sharedPaymentToken, amount, currency, checkoutId) {
  try {
    // Create and confirm payment intent with the shared token
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency.toLowerCase(),
      payment_method: sharedPaymentToken,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never'
      },
      metadata: {
        checkout_id: checkoutId,
        source: 'acp_chatgpt'
      }
    });

    return {
      success: true,
      status: paymentIntent.status, // 'succeeded', 'processing', 'requires_action', etc.
      payment_intent_id: paymentIntent.id,
      amount_captured: paymentIntent.amount_received,
      error: null
    };

  } catch (error) {
    console.error('Stripe payment error:', error);
    
    return {
      success: false,
      status: 'failed',
      payment_intent_id: null,
      amount_captured: 0,
      error: {
        code: error.code,
        message: error.message,
        type: error.type
      }
    };
  }
}

/**
 * Create a test payment method for demo purposes
 * Only works in test mode with Stripe test cards
 */
async function createTestPaymentMethod() {
  try {
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: '4242424242424242', // Test card
        exp_month: 12,
        exp_year: 2025,
        cvc: '123',
      },
    });
    
    return paymentMethod.id;
  } catch (error) {
    console.error('Error creating test payment method:', error);
    throw error;
  }
}

/**
 * Refund a payment
 * @param {string} paymentIntentId - Stripe Payment Intent ID
 * @param {number} amount - Amount to refund (optional, defaults to full refund)
 */
async function refundPayment(paymentIntentId, amount = null) {
  try {
    const refundParams = {
      payment_intent: paymentIntentId
    };
    
    if (amount) {
      refundParams.amount = amount;
    }
    
    const refund = await stripe.refunds.create(refundParams);
    
    return {
      success: true,
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount
    };
    
  } catch (error) {
    console.error('Refund error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verify webhook signature (for production use)
 */
function verifyWebhookSignature(payload, signature, secret) {
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, secret);
    return { valid: true, event };
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    return { valid: false, error: error.message };
  }
}

module.exports = {
  processPayment,
  createTestPaymentMethod,
  refundPayment,
  verifyWebhookSignature,
  stripe // Export stripe instance for advanced use
};
