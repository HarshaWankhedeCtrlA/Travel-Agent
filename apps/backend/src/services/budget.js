// Budget split across flights / stay / activities.
// Default: 40/40/20 per PRD §7.

export function splitBudget(totalBudget, nights, travelers) {
  const flights    = Math.round(totalBudget * 0.40);
  const stay       = Math.round(totalBudget * 0.40);
  const activities = Math.round(totalBudget * 0.20);

  return {
    total: totalBudget,
    flights: { total: flights, perPerson: Math.round(flights / Math.max(1, travelers)) },
    stay:    { total: stay, perNight: nights > 0 ? Math.round(stay / nights) : stay, nights },
    activities: { total: activities, perDay: nights > 0 ? Math.round(activities / nights) : activities },
    buffer: Math.round(totalBudget * 0.05),
  };
}

export function nightsBetween(departISO, returnISO) {
  const a = new Date(departISO);
  const b = new Date(returnISO);
  const diff = Math.round((b - a) / 86400000);
  return Math.max(1, diff);
}