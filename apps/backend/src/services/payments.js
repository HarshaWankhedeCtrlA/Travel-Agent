import { FEE_INR } from "../providers/payment.js";

// Builds the payment link the traveler gets on WhatsApp.
//
// No Razorpay call and no database write here: the checkout page creates the
// order itself (routes/payment.js, POST /create-order), and marking a trip as
// paid is done only by that route (/confirm and the webhook).
export async function initiateFee(trip) {
  if (trip.feePaid) return { alreadyPaid: true, amount: trip.feeAmount };

  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    url: `${base}/api/payment/checkout/${trip._id}`,
    amount: FEE_INR,
  };
}

export { FEE_INR };