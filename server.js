// server.js
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { processPayment, createTestPaymentMethod } = require('./services/stripe');
const app = express();

app.use(express.json());

// In-memory store (replace with Redis/Postgres in production)
const checkouts = new Map();
const products = new Map();

// Seed some products
products.set('prod_1', {
  id: 'prod_1',
  name: 'Organic Dark Chocolate Bar',
  description: 'Single-origin 70% cacao, vegan, no added sugar',
  price: { amount: 850, currency: 'USD' },
  availability: 'in_stock',
  images: ['https://example.com/chocolate.jpg'],
  shipping_info: {
    regions: ['US'],
    estimated_days_min: 2,
    estimated_days_max: 5
  },
  return_policy: {
    days: 30,
    conditions: 'Unopened items only'
  }
});

products.set('prod_2', {
  id: 'prod_2',
  name: 'Almond Butter Energy Bites - 12 Pack',
  description: 'Protein-packed snack bites, gluten-free, made with organic almonds and dates',
  price: { amount: 1499, currency: 'USD' },
  availability: 'in_stock',
  images: ['https://example.com/energy-bites.jpg'],
  shipping_info: {
    regions: ['US'],
    estimated_days_min: 2,
    estimated_days_max: 5
  },
  return_policy: {
    days: 30,
    conditions: 'Unopened items only'
  }
});

products.set('prod_3', {
  id: 'prod_3',
  name: 'Himalayan Sea Salt Dark Chocolate - Gift Set',
  description: '3-bar variety pack: 70%, 80%, and 90% cacao with pink Himalayan salt',
  price: { amount: 2400, currency: 'USD' },
  availability: 'in_stock',
  images: ['https://example.com/chocolate-gift-set.jpg'],
  shipping_info: {
    regions: ['US'],
    estimated_days_min: 2,
    estimated_days_max: 5
  },
  return_policy: {
    days: 30,
    conditions: 'Unopened items only'
  }
});

products.set('prod_4', {
  id: 'prod_4',
  name: 'Vegan Protein Bar Sampler - 6 Pack',
  description: 'Plant-based protein bars: chocolate, peanut butter, and berry flavors',
  price: { amount: 1899, currency: 'USD' },
  availability: 'in_stock',
  images: ['https://example.com/protein-bars.jpg'],
  shipping_info: {
    regions: ['US'],
    estimated_days_min: 2,
    estimated_days_max: 5
  },
  return_policy: {
    days: 30,
    conditions: 'Unopened items only'
  }
});

products.set('prod_5', {
  id: 'prod_5',
  name: 'Sugar-Free Dark Chocolate Truffles - Box of 9',
  description: 'Stevia-sweetened truffles, keto-friendly, 2g net carbs per truffle',
  price: { amount: 1799, currency: 'USD' },
  availability: 'in_stock',
  images: ['https://example.com/truffles.jpg'],
  shipping_info: {
    regions: ['US'],
    estimated_days_min: 2,
    estimated_days_max: 5
  },
  return_policy: {
    days: 30,
    conditions: 'Unopened items only'
  }
});

// ============================================
// PRODUCT FEED ENDPOINT
// ============================================
app.get('/commerce/feed', (req, res) => {
  const productArray = Array.from(products.values());
  
  res.json({
    products: productArray,
    last_updated: new Date().toISOString()
  });
});

// ============================================
// CREATE CHECKOUT
// ============================================
app.post('/commerce/checkout/create', (req, res) => {
  const { line_items, shipping_address, customer_email } = req.body;
  
  // Validate line items
  if (!line_items || line_items.length === 0) {
    return res.status(400).json({ error: 'No line items provided' });
  }
  
  // Calculate total
  let total = 0;
  const validatedItems = [];
  
  for (const item of line_items) {
    const product = products.get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `Product ${item.product_id} not found` });
    }
    if (product.availability !== 'in_stock') {
      return res.status(400).json({ error: `Product ${item.product_id} is out of stock` });
    }
    
    const itemTotal = product.price.amount * item.quantity;
    total += itemTotal;
    
    validatedItems.push({
      product_id: item.product_id,
      name: product.name,
      quantity: item.quantity,
      unit_price: product.price,
      total: { amount: itemTotal, currency: product.price.currency }
    });
  }
  
  // Create checkout
  const checkoutId = `checkout_${crypto.randomBytes(16).toString('hex')}`;
  const checkout = {
    id: checkoutId,
    status: 'pending_info',
    line_items: validatedItems,
    total: { amount: total, currency: 'USD' },
    shipping_address: shipping_address || null,
    customer_email: customer_email || null,
    payment_method: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  checkouts.set(checkoutId, checkout);
  
  res.status(201).json(checkout);
});

// ============================================
// UPDATE CHECKOUT
// ============================================
app.post('/commerce/checkout/update', (req, res) => {
  const { checkout_id, shipping_address, customer_email } = req.body;
  
  const checkout = checkouts.get(checkout_id);
  if (!checkout) {
    return res.status(404).json({ error: 'Checkout not found' });
  }
  
  // Update fields
  if (shipping_address) {
    checkout.shipping_address = shipping_address;
  }
  if (customer_email) {
    checkout.customer_email = customer_email;
  }
  
  // Update status if we have all required info
  if (checkout.shipping_address && checkout.customer_email) {
    checkout.status = 'pending_payment';
  }
  
  checkout.updated_at = new Date().toISOString();
  checkouts.set(checkout_id, checkout);
  
  res.json(checkout);
});

// ============================================
// COMPLETE CHECKOUT (Process Payment)
// ============================================
app.post('/commerce/checkout/complete', async (req, res) => {
  const { checkout_id, shared_payment_token } = req.body;
  
  const checkout = checkouts.get(checkout_id);
  if (!checkout) {
    return res.status(404).json({ error: 'Checkout not found' });
  }
  
  if (checkout.status !== 'pending_payment') {
    return res.status(400).json({ error: 'Checkout not ready for payment' });
  }
  
  // Process payment with Stripe
  const paymentResult = await processPayment(
    shared_payment_token,
    checkout.total.amount,
    checkout.total.currency,
    checkout_id
  );
  
  if (!paymentResult.success) {
    checkout.status = 'payment_failed';
    checkout.payment_error = paymentResult.error;
    checkout.updated_at = new Date().toISOString();
    checkouts.set(checkout_id, checkout);
    
    return res.status(402).json({
      ...checkout,
      payment_status: 'failed',
      error: paymentResult.error.message
    });
  }
  
  // Payment succeeded
  checkout.status = 'completed';
  checkout.payment_method = 'card';
  checkout.payment_intent_id = paymentResult.payment_intent_id;
  checkout.completed_at = new Date().toISOString();
  checkout.updated_at = new Date().toISOString();
  
  checkouts.set(checkout_id, checkout);
  
  // TODO: Send confirmation email
  // TODO: Create fulfillment order
  // TODO: Update inventory
  
  const orderId = `order_${crypto.randomBytes(8).toString('hex')}`;
  
  console.log(`✅ Order ${orderId} completed - Payment: ${paymentResult.payment_intent_id}`);
  
  res.json({
    ...checkout,
    payment_status: paymentResult.status,
    order_id: orderId
  });
});

// ============================================
// CANCEL CHECKOUT
// ============================================
app.post('/commerce/checkout/cancel', (req, res) => {
  const { checkout_id, reason } = req.body;
  
  const checkout = checkouts.get(checkout_id);
  if (!checkout) {
    return res.status(404).json({ error: 'Checkout not found' });
  }
  
  checkout.status = 'cancelled';
  checkout.cancellation_reason = reason || 'user_cancelled';
  checkout.updated_at = new Date().toISOString();
  
  checkouts.set(checkout_id, checkout);
  
  res.json(checkout);
});

// ============================================
// GET CHECKOUT
// ============================================
app.get('/commerce/checkout/:id', (req, res) => {
  const checkout = checkouts.get(req.params.id);
  
  if (!checkout) {
    return res.status(404).json({ error: 'Checkout not found' });
  }
  
  res.json(checkout);
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    checkouts_count: checkouts.size,
    products_count: products.size,
    stripe_configured: !!process.env.STRIPE_SECRET_KEY
  });
});

// ============================================
// TEST ENDPOINT - Get test payment tokens
// ============================================
app.get('/test/payment-tokens', (req, res) => {
  res.json({
    success: true,
    test_tokens: {
      visa_success: 'pm_card_visa',
      visa_decline: 'pm_card_chargeDeclined',
      mastercard: 'pm_card_mastercard',
      amex: 'pm_card_amex'
    },
    note: 'Use these test tokens as shared_payment_token. pm_card_visa will succeed.',
    docs: 'https://stripe.com/docs/testing#cards'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ACP server running on port ${PORT}`);
  console.log(`Feed: http://localhost:${PORT}/commerce/feed`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Test: http://localhost:${PORT}/test/payment-tokens`);
});