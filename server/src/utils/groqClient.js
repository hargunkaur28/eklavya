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

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Groq API responded with status ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}
