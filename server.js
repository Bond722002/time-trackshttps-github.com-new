import express from 'express';
import Stripe from 'stripe';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 3000);
const siteUrl = (process.env.SITE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const root = path.dirname(fileURLToPath(import.meta.url));
const priceInMinorUnits = 2500; // MYR 25.00; MYR uses 2 decimal places.

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes('replace_me')) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in the deployment environment.');
  }
  return new Stripe(key);
}

// Stripe webhooks need the raw request body for signature verification.
app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) return res.status(400).send('Webhook is not configured.');

  try {
    const event = stripeClient().webhooks.constructEvent(req.body, signature, secret);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      console.info('Checkout paid:', session.id, session.payment_status);
      // Add your fulfillment workflow here. Do not treat the browser success redirect as proof of payment.
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('Invalid Stripe webhook:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

app.use(express.json({ limit: '20kb' }));

app.post('/api/create-checkout-session', async (_req, res) => {
  try {
    const session = await stripeClient().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'myr',
          unit_amount: priceInMinorUnits,
          product_data: {
            name: 'The Moving Camera — one-time payment',
            description: 'One-time payment of MYR 25.00. No recurring charges.',
          },
        },
        quantity: 1,
      }],
      success_url: `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/?payment=cancelled`,
      billing_address_collection: 'auto',
    });
    return res.json({ url: session.url });
  } catch (error) {
    console.error('Unable to create Checkout Session:', error.message);
    return res.status(503).json({ error: 'Checkout is currently unavailable. Please try again later.' });
  }
});

const pages = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/privacy.html': 'privacy.html',
  '/terms.html': 'terms.html',
  '/ads.txt': 'ads.txt',
  '/manifest.json': 'manifest.json',
  '/sw.js': 'sw.js',
  '/LICENSE': 'LICENSE',
};
for (const [route, filename] of Object.entries(pages)) {
  app.get(route, async (_req, res, next) => {
    try {
      const content = await readFile(path.join(root, filename));
      if (filename.endsWith('.json')) res.type('application/manifest+json');
      else if (filename.endsWith('.js')) res.type('application/javascript');
      else if (filename === 'ads.txt') res.type('text/plain');
      else if (filename === 'LICENSE') res.type('text/plain');
      else res.type('html');
      res.send(content);
    } catch (error) { next(error); }
  });
}

app.listen(port, () => console.info(`The Moving Camera site listening on port ${port}`));
