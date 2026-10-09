// Mock WhatsApp provider.
// Logs messages + keeps an in-memory outbox so the chat-mock UI can poll replies.

const outbox = new Map(); // phone -> [{ id, body, at }]

function genId() {
  return "wa_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export async function sendText(to, body) {
  const id = genId();
  console.log(`\n[WA → ${to}]\n${body}\n`);
  pushOutbox(to, { id, body, at: Date.now() });
  return { id };
}

export async function sendButtons(to, body, buttons) {
  const id = genId();
  const label = buttons.map((b) => b.title).join(" | ");
  console.log(`\n[WA → ${to}]\n${body}\n[Buttons: ${label}]\n`);
  pushOutbox(to, { id, body, buttons, at: Date.now() });
  return { id };
}

function pushOutbox(phone, msg) {
  if (!outbox.has(phone)) outbox.set(phone, []);
  outbox.get(phone).push(msg);
}

export function drainOutbox(phone) {
  const msgs = outbox.get(phone) || [];
  outbox.set(phone, []);
  return msgs;
}