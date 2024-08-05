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
      console.log('hehehehe', event);
  } catch (err) {
      console.log(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
      case 'payment_intent.succeeded':
          const paymentIntent = event.data.object;
          console.log('PaymentIntent was successful!');

          // Add your Firestore update logic here
          try {
              const docRef = db.collection('payments').doc(paymentIntent.id);
              await docRef.set({
                  amount: paymentIntent.amount,
                  currency: paymentIntent.currency,
                  status: paymentIntent.status,
                  created: paymentIntent.created,
                  customer: paymentIntent.customer
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

// Endpoint to create a payment intent
app.post('/create-payment-intent', async (req, res) => {
  const { amount, userId, userName, userEmail } = req.body; // Accept user details in the request body
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      metadata: {
        userId,
        userName,
        userEmail,
      },
    });
    res.status(200).send({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

app.post('/payment-sheet', async (req, res) => {
  const { amount } = req.body;
  try {
    // Create a new customer
    const customer = await stripe.customers.create();

    // Create an ephemeral key for the customer
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customer.id },
      { apiVersion: '2022-11-15' }
    );

    // Create a PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      metadata: {
        userId: customer.id,
      },
    });

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customer.id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const port = 3000;
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Start the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});