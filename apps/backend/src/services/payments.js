import Trip from "../models/trip.js";
import { createPaymentLink, FEE_INR } from "../providers/payment.js";

export async function initiateFee(trip) {
  if (trip.feePaid) return { alreadyPaid: true, amount: trip.feeAmount };

  const { id, url, amount } = await createPaymentLink({
  tripId: trip._id.toString(),
  amount: FEE_INR,
});

  trip.paymentId = id;
  trip.feeAmount = amount;
  await trip.save();

  return { id, url, amount };
}

export async function markPaid(tripId, paymentId, amount) {
  const trip = await Trip.findById(tripId);
  if (!trip) throw new Error("Trip not found");
  trip.feePaid = true;
  trip.feeAmount = amount;
  trip.paymentId = paymentId;
  trip.paidAt = new Date();
  await trip.save();
  return trip;
}

export { FEE_INR };