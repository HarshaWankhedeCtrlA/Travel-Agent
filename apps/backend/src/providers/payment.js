// Real payment provider using Razorpay.
// Works in test mode (no KYC) and live mode (after KYC).

import Razorpay from "razorpay";
import crypto from "node:crypto";

const FEE_INR = 499;

let client = null;
function getClient() {
  if (client) return client;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) throw new Error("Razorpay credentials not set");
  client = new Razorpay({ key_id, key_secret });
  return client;
}

export async function createPaymentLink({ tripId, amount = FEE_INR }) {
  const rzp = getClient();

  const order = await rzp.orders.create({
    amount: amount * 100,          // paise
    currency: "INR",
    receipt: `trip_${tripId}`,
    notes: { tripId: String(tripId) },
  });

  const url = `${process.env.APP_BASE_URL || "http://localhost:3000"}/api/payment/checkout/${tripId}?order_id=${order.id}&amount=${amount}`;

  console.log(`\n[PAYMENT] Razorpay order ${order.id} for ₹${amount} → ${url}\n`);

  return { id: order.id, url, amount };
}

export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  return expected === signature;
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return expected === signature;
}

export { FEE_INR };