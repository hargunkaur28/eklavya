// Groq AI Fallback Translator when Sarvam is out of credits or unavailable
async function translateWithGroqFallback(text, targetLang = 'hi') {
  if (!text || typeof text !== 'string') return null;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'groq_demo_key') return null;

  try {
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
            content: 'You are an expert Hindi educational translator. Translate the given text into clear, natural Hindi in Devanagari script. Preserve all mathematical formulas (e.g. P(A|B) = P(A and B) / P(B)). Return ONLY the translated Hindi text without any English commentary, intro, or quotation marks.'
          },
          {
            role: 'user',
            content: text
          }
        ],
        temperature: 0.2
      })
    });

    if (response.ok) {
      const data = await response.json();
      const translated = data.choices?.[0]?.message?.content?.trim();
      if (translated && translated.trim() !== text.trim()) {
        return translated;
      }
    }
  } catch (error) {
    console.warn('Groq translation fallback error:', error.message);
  }
  return null;
}

// Shared Sarvam Translate helper with Groq fallback, paragraph chunking, and retry logic
export async function translateTextWithSarvam(text, targetLang = 'hi-IN', retries = 1) {
  if (!text || typeof text !== 'string') return null;
  const sarvamApiKey = process.env.SARVAM_API_KEY;

  // Handle long prose by splitting by paragraphs (\n\n or \n) to comply with Sarvam / Groq length limits
  if (text.length > 300 && text.includes('\n')) {
    const lines = text.split('\n');
    const translatedLines = [];
    for (const line of lines) {
      if (line.trim().length > 0) {
        const transLine = await translateTextWithSarvam(line.trim(), targetLang, retries);
        translatedLines.push(transLine || line.trim());
      } else {
        translatedLines.push('');
      }
    }
    const joined = translatedLines.join('\n');
    if (joined && joined.trim() !== text.trim()) {
      return joined;
    }
  }

  // Try Sarvam AI first if API key is provided
  if (sarvamApiKey && sarvamApiKey !== 'sarvam_demo_key') {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch('https://api.sarvam.ai/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-subscription-key': sarvamApiKey
          },
          body: JSON.stringify({
            input: text,
            source_language_code: 'en-IN',
            target_language_code: targetLang,
            speaker_gender: 'Female',
            mode: 'formal'
          })
        });

        if (response.ok) {
          const data = await response.json();
          if (data.translated_text && data.translated_text.trim() !== text.trim()) {
            return data.translated_text;
          }
        } else {
          console.warn(`Sarvam API returned HTTP ${response.status} (likely out of credits or rate limited)`);
        }
      } catch (error) {
        console.warn(`Sarvam translation attempt ${attempt + 1} failed:`, error.message);
      }
    }
  }

  // Fallback to Groq AI if Sarvam fails or is out of credits
  const groqTranslated = await translateWithGroqFallback(text, targetLang);
  if (groqTranslated) {
    return groqTranslated;
  }

  return null;
}

export async function translateQuestionsArray(questions) {
  const translated = [];
  for (const q of questions) {
    const rawStem = q.questionText || q.question;
    const questionText = (await translateTextWithSarvam(rawStem)) || rawStem;
    const options = [];
    if (Array.isArray(q.options)) {
      for (const opt of q.options) {
        const transOpt = await translateTextWithSarvam(opt);
        options.push(transOpt || opt);
      }
    }
    const explanation = q.explanation ? ((await translateTextWithSarvam(q.explanation)) || q.explanation) : '';

    translated.push({
      questionText,
      options,
      explanation
    });
  }
  return translated;
}
