// Add the respective keys below
const DATABASE_URL = 'your-database-url';
const STRIPE_SECRET_KEY = 'stripe-secret-key';
const WEBHOOK_SIGNING_KEY = 'webhook-signing-key'

const express = require('express');
const bodyParser = require('body-parser');
const stripe = require('stripe')(STRIPE_SECRET_KEY); 
const admin = require('firebase-admin');
const serviceAccount = require('./firebaseServiceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL // Replace with your Firebase database URL
});

const db = admin.firestore();

const app = express();

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    // Convert the raw body buffer to a string before passing it to constructEvent
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SIGNING_KEY);
  } catch (err) {
    console.log(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;

      // Extract necessary information
      const customerId = paymentIntent.customer;
      const userId = paymentIntent.metadata.userId;
      const email = paymentIntent.receipt_email;
      const amount = paymentIntent.amount_received / 100; // Convert to dollars
      const paymentTime = new Date(paymentIntent.created * 1000).toISOString();
      const barberId = paymentIntent.metadata.barberId;

      // Add your Firestore update logic here
      try {
        const paymentDocRef = db.collection('payments').doc(paymentIntent.id);
        await paymentDocRef.set({
          customerId: customerId,
          userId: userId,
          email: email,
          amount: amount,
          paymentTime: paymentTime,
          status: paymentIntent.status,
          barberId: barberId, // Store the barber ID
        });
        console.log('Payment recorded in Firestore');
      } catch (error) {
        console.error('Error writing to Firestore: ', error);
      }
      break;
    // Add handling for other event types here
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a response to acknowledge receipt of the event
  res.json({ received: true });
});

app.use(bodyParser.json());

// Deposit money APIs

// Endpoint to create a payment intent
app.post('/payment-sheet', async (req, res) => {
  const { amount, customerId, userName, userEmail, barberId } = req.body;

  try {
    // Fetch user document from Firestore
    const userDoc = await db.collection('users').doc(customerId).get();

    let stripeCustomerId;

    if (userDoc.exists && userDoc.data().stripeCustomerId) {
      // Use existing Stripe customer ID
      stripeCustomerId = userDoc.data().stripeCustomerId;
      console.log('Using existing Stripe customer ID:', stripeCustomerId);
    } else {
      // Create a new customer
      const customer = await stripe.customers.create({
        name: userName,
        email: userEmail,
        metadata: {
          firebaseUID: customerId,
        },
      });

      // Save the new customer ID in Firestore
      await db.collection('users').doc(customerId).set({
        stripeCustomerId: customer.id,
      }, { merge: true });

      stripeCustomerId = customer.id;
      console.log('Created new Stripe customer ID:', stripeCustomerId);
    }

    // Create an ephemeral key for the customer
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: stripeCustomerId },
      { apiVersion: '2022-11-15' }
    );

    // Create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      customer: stripeCustomerId,
      receipt_email: userEmail, // Set the email for the receipt
      metadata: {
        userId: customerId, // Store the user ID in metadata
        userName: userName,
        userEmail: userEmail,
        barberId: barberId, // Store the barber ID in metadata
      },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: stripeCustomerId,
    });
  } catch (error) {
    console.error('Error creating customer or payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/payment-sheet', async (req, res) => {
  const { amount, customerId, userName, userEmail } = req.body;

  try {
    // Create a new customer with additional information
    const customer = await stripe.customers.create({
      name: userName,
      email: userEmail,
      metadata: {
        firebaseUID: customerId,
      },
    });

    // Create an ephemeral key for the customer
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2022-11-15' }
    );

    // Create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      customer: customer.id,
      metadata: {
        userId: customerId, // Store the user ID with the payment
        userName: userName,
        userEmail: userEmail,
      },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    console.error('Error creating customer or payment intent:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-connected-account', async (req, res) => {
  const { barberId, email } = req.body;

  try {
    const account = await stripe.accounts.create({
      type: 'express',
      email: email,
      country: 'UK',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // Save the account ID in your database
    await db.collection('barbers').doc(barberId).set({
      stripeAccountId: account.id,
    }, { merge: true });

    res.json({ accountId: account.id });
  } catch (error) {
    console.error('Error creating connected account:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/create-account-link', async (req, res) => {
  const { accountId, refreshUrl, returnUrl } = req.body;

  try {
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (error) {
    console.error('Error creating account link:', error);
    res.status(500).json({ error: error.message });
  }
});

// Withdraw money API

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});