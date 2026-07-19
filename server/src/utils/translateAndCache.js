// Shared Sarvam Translate helper with paragraph chunking, retry logic, and strict validation
export async function translateTextWithSarvam(text, targetLang = 'hi-IN', retries = 2) {
  if (!text || typeof text !== 'string') return null;
  const sarvamApiKey = process.env.SARVAM_API_KEY;
  if (!sarvamApiKey || sarvamApiKey === 'sarvam_demo_key') {
    return null;
  }

  // Handle long prose by splitting by paragraphs (\n\n or \n) to comply with Sarvam length limits
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
    return translatedLines.join('\n');
  }

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
      }
    } catch (error) {
      console.warn(`Sarvam translation attempt ${attempt + 1} failed for string "${text.substring(0, 20)}...":`, error.message);
    }
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
