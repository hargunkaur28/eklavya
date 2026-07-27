// Shared Groq chat-completions client. Extracted from chat.js so the chatbot,
// Mentor (Track 1), PDF Notes (Track 2), and essay grading (Track 3) all call Groq
// ONE way instead of duplicating the model / temperature / endpoint. Defaults
// match the original chatbot call (llama-3.3-70b-versatile @ 0.4) so existing
// behaviour is unchanged; callers can override per use.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

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

  let response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  // Model fallback on 429 rate limit (e.g. 70b daily token limit reached)
  if (response.status === 429 && model === DEFAULT_MODEL) {
    console.warn(`Groq 70b model rate limited (429). Retrying with fallback model 'llama-3.1-8b-instant'...`);
    body.model = 'llama-3.1-8b-instant';
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  }

  // Final fallback to OpenAI gpt-4o-mini if all Groq attempts failed and OPENAI_API_KEY is available
  if (!response.ok && process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'invalid_openai_key') {
    try {
      console.warn(`Groq models failed (${response.status}). Attempting final fallback to OpenAI 'gpt-4o-mini'...`);
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages,
          temperature,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          ...(maxTokens ? { max_tokens: maxTokens } : {})
        })
      });

      if (openaiRes.ok) {
        const odata = await openaiRes.json();
        const otext = odata.choices?.[0]?.message?.content?.trim();
        if (otext) return otext;
      }
    } catch (oerr) {
      console.error('OpenAI chat fallback also failed:', oerr.message);
    }
  }

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Groq Error ${response.status}]:`, errText);
    throw new Error(`Groq API responded with status ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
