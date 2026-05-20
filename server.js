const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Check if user has active subscription
async function hasActiveSubscription(email) {
  if (!email) return false;
  try {
    const customers = await stripe.customers.list({ email: email, limit: 1 });
    if (customers.data.length === 0) return false;
    const customer = customers.data[0];
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'active',
      limit: 1
    });
    return subscriptions.data.length > 0;
  } catch (error) {
    return false;
  }
}

// Track free messages per session
const freeSessions = {};

// Claude API proxy - with paywall
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, system, email, sessionId } = req.body;

    // Check if paid subscriber
    if (email) {
      const paid = await hasActiveSubscription(email);
      if (paid) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2000,
            system: system || '',
            messages: messages
          })
        });
        const data = await response.json();
        return res.json(data);
      }
    }

    // Free user - allow 2 messages only
    if (sessionId) {
      if (!freeSessions[sessionId]) {
        freeSessions[sessionId] = 0;
      }
      if (freeSessions[sessionId] >= 2) {
        return res.status(403).json({
          error: 'FREE_LIMIT_REACHED',
          message: 'You have used your 2 free messages. Subscribe for unlimited access.'
        });
      }
      freeSessions[sessionId]++;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: system || '',
        messages: messages
      })
    });
    const data = await response.json();
    res.json(data);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Stripe checkout session
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { email } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Sahel Pro — UAE Expat Survival Kit',
            description: 'Unlimited documents, contracts, legal letters and calculators. Cancel anytime.',
          },
          unit_amount: 2999,
          recurring: { interval: 'month' }
        },
        quantity: 1,
      }],
      mode: 'subscription',
      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/`,
    });
    res.json({ url: session.url });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify subscription status
app.post('/api/verify-subscription', async (req, res) => {
  try {
    const { email } = req.body;
    const active = await hasActiveSubscription(email);
    res.json({ active });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve index.html for all routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sahel running on port ${PORT}`));
