// Generates the next question to ask the user, using the LLM.
// Falls back to a template if the LLM call fails.

const GROQ_URL = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1") + "/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const FIELD_LABELS = {
  origin: "departure city",
  destination: "destination",
  departDate: "travel start date",
  returnDate: "return date or length of stay",
  travelers: "number of travelers",
  budget: "total trip budget in rupees",
};

const FALLBACKS = {
  origin: "Where are you travelling from?",
  destination: "Where are you headed?",
  departDate: "When do you want to travel?",
  returnDate: "How many nights will you stay, or when do you come back?",
  travelers: "How many people are traveling?",
  budget: "What's your total budget in rupees?",
};

export async function askMissing(field, brief) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return FALLBACKS[field] || "Tell me more.";

  const known = Object.entries(brief)
    .filter(([k, v]) => v && !k.startsWith("_"))
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const lastUserMessage = brief._lastUserMessage || "";

  const prompt = `You are a friendly travel assistant on WhatsApp.

The user's last message was: "${lastUserMessage}"
Already known about their trip: ${known || "(nothing yet)"}
Missing field: ${field}

Task: Ask the user ONE short question to get their "${FIELD_LABELS[field] || field}".

Rules:
- **Detect the user's language** and reply in the SAME language/style.
  - If they wrote in English, reply in English.
  - If they wrote in Hindi, reply in Hindi (Devanagari).
  - If they wrote in Hinglish (Roman Hindi), reply in Hinglish.
- Ask ONE question only, one line, max 15 words.
- Friendly and casual, like a human travel agent.
- No emojis.
- **Phrasing rules (CRITICAL):**
  - If asking for **origin**: ask "Where are you travelling from?" or "Which city are you starting from?" — do NOT say "from [destination]".
  - If asking for **destination**: ask "Where are you headed?" or "Where would you like to go?" — do NOT say "to [origin]".
  - If asking for **departDate**: mention the destination if known.
  - If asking for **returnDate**: ask "How many nights?" or "When do you come back?"
  - If asking for **travelers**: "How many people?"
  - If asking for **budget**: "What's your budget?"
- Do NOT reference a city in a way that misassigns it as origin/destination.
- Output only the question, no quotes, no explanation.`;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300,
        reasoning_effort: "low",
        temperature: 0.7,
      }),
    });

    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content?.trim();

    // Retry once if empty (reasoning models sometimes return empty)
    if (!text) {
      const retry = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 300,
          temperature: 0.7,
        }),
      });
      const retryData = await retry.json();
      text = retryData.choices?.[0]?.message?.content?.trim();
    }

    if (!text) throw new Error("empty");
    return text;
  } catch (err) {
    console.error("[ask] fallback to template:", err.message);
    return FALLBACKS[field] || "Tell me more.";
  }
}