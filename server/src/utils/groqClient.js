// Shared Groq chat-completions client. Extracted from chat.js so the chatbot,
// Mentor (Track 1), PDF Notes (Track 2), and essay grading (Track 3) all call Groq
// ONE way instead of duplicating the model / temperature / endpoint. Defaults
// match the original chatbot call (llama-3.3-70b-versatile @ 0.4) so existing
// behaviour is unchanged; callers can override per use.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

// Rate-limit circuit breaker.
//
// Without this, EVERY call re-tries a model we already know is rate limited:
// 70b → 429 → 8b → 429 → OpenAI, three round-trips for one logical call. Once a
// diagnostic is issuing several calls per round that is the dominant source of
// latency, and it is pure waste — the 429 is a property of the window, not of the
// request. So a 429 marks that model as unavailable for a cooldown and subsequent
// calls skip straight to the next tier.
//
// Deliberately short (60 s): Groq publishes per-minute limits, so this recovers on
// its own. A daily-quota exhaustion simply re-trips it once a minute, which costs
// one wasted call per minute instead of one per request.
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const rateLimitedUntil = new Map(); // model -> timestamp

const isRateLimited = (model) => (rateLimitedUntil.get(model) || 0) > Date.now();
const markRateLimited = (model) => {
  if (!isRateLimited(model)) {
    console.warn(`Groq model '${model}' rate limited (429) — skipping it for ${RATE_LIMIT_COOLDOWN_MS / 1000}s.`);
  }
  rateLimitedUntil.set(model, Date.now() + RATE_LIMIT_COOLDOWN_MS);
};

/**
 * Call OpenAI directly. Exported because ONE path in this app deliberately prefers
 * OpenAI over Groq — see DIAGRAM_MODEL in utils/generateDiagram.js. Everywhere else
 * goes through callGroqChat below, which uses this only as a last-resort fallback.
 *
 * Returns the message text, or null on any failure. Never throws, so callers can
 * fall through to another provider without a try/catch at every site.
 */
export async function callOpenAIChat(messages, { model = 'gpt-4o-mini', temperature = 0.7, jsonMode = false, maxTokens } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'invalid_openai_key') return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {})
      })
    });
    if (!res.ok) {
      console.warn(`OpenAI '${model}' returned HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error(`OpenAI '${model}' call failed:`, err.message);
    return null;
  }
}

export async function callGroqChat(
  messages,
  { jsonMode = false, temperature = 0.4, model = DEFAULT_MODEL, maxTokens } = {}
) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API key not configured');
  }

  const body = { model, messages, temperature };
  if (jsonMode) body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;

  const post = (m) => {
    body.model = m;
    return fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  };

  // Skip any tier we already know is rate limited rather than paying for the 429.
  let response;
  if (!isRateLimited(model)) {
    response = await post(model);
    if (response.status === 429) markRateLimited(model);
  }

  // Model fallback on 429 rate limit (e.g. 70b daily token limit reached)
  if ((!response || response.status === 429) && model === DEFAULT_MODEL) {
    if (isRateLimited(FALLBACK_MODEL)) {
      response = response || { ok: false, status: 429, text: async () => 'rate limited (cached)' };
    } else {
      response = await post(FALLBACK_MODEL);
      if (response.status === 429) markRateLimited(FALLBACK_MODEL);
    }
  }

  // Both Groq tiers are in cooldown and there is nothing to fall back from.
  if (!response) {
    response = { ok: false, status: 429, text: async () => 'all Groq models rate limited (cached)' };
  }

  // Final fallback to OpenAI if every Groq attempt failed. Same helper the
  // diagram path uses as its PRIMARY — one implementation, two call orders.
  if (!response.ok) {
    console.warn(`Groq models failed (${response.status}). Attempting final fallback to OpenAI 'gpt-4o-mini'...`);
    const otext = await callOpenAIChat(messages, { model: 'gpt-4o-mini', temperature, jsonMode, maxTokens });
    if (otext) return otext;
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Groq Error ${response.status}]:`, errText);
    throw new Error(`Groq API responded with status ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
