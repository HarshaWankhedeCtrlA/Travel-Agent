// Mock payment provider. Creates UPI-style payment links.
// Real implementation: Razorpay / Cashfree / PhonePe.

const FEE_INR = 499;

function genId() {
  return "pay_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export function createPaymentLink({ tripId, amount = FEE_INR }) {
  const id = genId();
  const url = `${process.env.APP_BASE_URL || "http://localhost:3000"}/api/payment/checkout/${tripId}?id=${id}&amount=${amount}`;
  console.log(`\n[PAYMENT] Created ${id} for ₹${amount} → ${url}\n`);
  return { id, url, amount };
}

export function verifyWebhook(payload, signature) {
  // Mock: always valid
  return true;
}

export { FEE_INR };