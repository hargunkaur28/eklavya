// Bilingual reply localization helper for the chat assistant.
// Applies to ALL reply types (general Q&A, navigation, resources) as a single
// shared step — never duplicated inside individual intent branches.
//
// Fallback chain: Sarvam Translate → Groq translation → English + disclaimer note

import { sarvamTranslate } from './sarvamClient.js';

/**
 * Groq-based translation fallback when Sarvam is unavailable.
 * Same model/prompt pattern as translateAndCache.js's translateWithGroqFallback.
 */
async function groqTranslateFallback(englishText) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'gsk_demo_key') {
    throw new Error('Groq API key not configured');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'Translate the following into natural, conversational Hindi in Devanagari script. Return ONLY the translated text, nothing else. No English commentary, intro, or quotation marks.'
        },
        {
          role: 'user',
          content: englishText
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`Groq API responded with status ${response.status}`);
  }

  const data = await response.json();
  const translated = data.choices?.[0]?.message?.content?.trim();

  if (!translated || translated.trim() === englishText.trim()) {
    throw new Error('Groq returned empty or identical text');
  }

  return translated;
}

/**
 * Localize a chat reply from English to the target language.
 * Used by all three reply types (general Q&A, navigation, resources).
 *
 * @param {string} englishText - The reply text in English
 * @param {string} targetLanguage - 'en' or 'hi'
 * @returns {Promise<string>} Localized text (never throws, always returns something)
 */
export async function localizeReply(englishText, targetLanguage) {
  // No-op for English
  if (targetLanguage === 'en' || !targetLanguage) return englishText;

  // Primary: Sarvam Translate (en-IN → hi-IN)
  try {
    const translated = await sarvamTranslate(englishText, 'en-IN', 'hi-IN');
    if (translated) return translated;
    // sarvamTranslate returns null on failure — fall through to Groq
    console.warn('Sarvam translate returned null, falling back to Groq');
  } catch (err) {
    console.error('Sarvam translate failed, falling back to Groq Hindi generation:', err.message);
  }

  // Fallback 1: Groq translation
  try {
    const hindiFromGroq = await groqTranslateFallback(englishText);
    return hindiFromGroq;
  } catch (fallbackErr) {
    console.error('Groq fallback also failed, returning English with a note:', fallbackErr.message);
  }

  // Fallback 2: English text with disclaimer
  return englishText + ' [Hindi translation unavailable right now]';
}
