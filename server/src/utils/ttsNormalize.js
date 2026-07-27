/**
 * Universal Text Normalization for TTS (Math symbols & Question formatting)
 * Distinguishes arithmetic operators from word hyphens (e.g. '5 - 3' vs 'real-life').
 * Preserves URLs, markdown bold/italics, and compound hyphenated words.
 */

export function fixCyrillicDevanagariHomoglyphs(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\u0440\u043E(?=[\u0900-\u097F])/g, 'रो')
    .replace(/(?<=[\u0900-\u097F])\u0440\u043E/g, 'रो')
    .replace(/\u0440(?=[\u0900-\u097F])/g, 'र')
    .replace(/(?<=[\u0900-\u097F])\u0440/g, 'र')
    .replace(/\u043E(?=[\u0900-\u097F])/g, 'ो')
    .replace(/(?<=[\u0900-\u097F])\u043E/g, 'ो');
}

export function normalizeTextForTTS(text, lang = 'en') {
  if (!text || typeof text !== 'string') return '';

  const isHindi = lang === 'hi' || lang === 'hi-IN';

  let normalized = fixCyrillicDevanagariHomoglyphs(text);

  // 1. Clean markdown bold/italics syntax so asterisks are not spoken as symbols
  normalized = normalized.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');

  // 2. Temporarily protect URLs so slashes in http:// or https:// are untouched
  const urlMap = new Map();
  let urlCounter = 0;
  normalized = normalized.replace(/https?:\/\/[^\s]+/g, (url) => {
    const placeholder = `__URL_PH_${urlCounter++}__`;
    urlMap.set(placeholder, url);
    return placeholder;
  });

  if (isHindi) {
    normalized = normalized
      .replace(/(\d|[a-zA-Z]|\s)\s*\*\s*(\d|[a-zA-Z]|\s)/g, '$1 गुना $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\/\s*(\d|[a-zA-Z]|\s)/g, '$1 भाग $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\+\s*(\d|[a-zA-Z]|\s)/g, '$1 प्लस $2')
      // Minus: only match arithmetic minus (surrounded by spaces or digits/variables), NOT word hyphens (like real-life)
      .replace(/(?<![a-zA-Z\u0900-\u097F])\s*-\s*(?![a-zA-Z\u0900-\u097F])/g, ' माइनस ')
      .replace(/(\d|[a-zA-Z]|\s)\s*=\s*(\d|[a-zA-Z]|\s)/g, '$1 बराबर $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\^\s*(\d|[a-zA-Z]|\s)/g, '$1 की घात $2')
      .replace(/(\d+)\s*%/g, '$1 प्रतिशत');
  } else {
    normalized = normalized
      .replace(/(\d|[a-zA-Z]|\s)\s*\*\s*(\d|[a-zA-Z]|\s)/g, '$1 times $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\/\s*(\d|[a-zA-Z]|\s)/g, '$1 divided by $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\+\s*(\d|[a-zA-Z]|\s)/g, '$1 plus $2')
      // Minus: only match arithmetic minus (surrounded by spaces or digits/variables), NOT word hyphens (like real-life)
      .replace(/(?<![a-zA-Z\u0900-\u097F])\s*-\s*(?![a-zA-Z\u0900-\u097F])/g, ' minus ')
      .replace(/(\d|[a-zA-Z]|\s)\s*=\s*(\d|[a-zA-Z]|\s)/g, '$1 equals $2')
      .replace(/(\d|[a-zA-Z]|\s)\s*\^\s*(\d|[a-zA-Z]|\s)/g, '$1 to the power of $2')
      .replace(/(\d+)\s*%/g, '$1 percent');
  }

  // Restore protected URLs
  urlMap.forEach((originalUrl, placeholder) => {
    normalized = normalized.replace(placeholder, originalUrl);
  });

  return normalized.replace(/\s+/g, ' ').trim();
}

export function formatQuestionForTTS(questionText, options = [], lang = 'en') {
  const isHindi = lang === 'hi' || lang === 'hi-IN';
  const optLabels = ['A', 'B', 'C', 'D'];
  const optsList = Array.isArray(options) ? options : [];

  const optionsStr = optsList
    .map((opt, i) => `${isHindi ? 'विकल्प' : 'Option'} ${optLabels[i] || (i + 1)}: ${opt}`)
    .join('. ');

  const rawText = optionsStr
    ? `${isHindi ? 'प्रश्न' : 'Question'}: ${questionText}. ${optionsStr}.`
    : `${isHindi ? 'प्रश्न' : 'Question'}: ${questionText}.`;

  return normalizeTextForTTS(rawText, lang);
}

export function buildLiveQuizNarrationText(questionPayload, lang = 'en') {
  if (!questionPayload || typeof questionPayload !== 'object') return '';
  const isHindi = lang === 'hi' || lang === 'hi-IN';

  // Pull translated Hindi text & options when available in Hindi mode
  const questionText = (isHindi && (questionPayload.translatedHindiQuestionText || questionPayload.hindiQuestionText || questionPayload.translatedQuestionText))
    ? (questionPayload.translatedHindiQuestionText || questionPayload.hindiQuestionText || questionPayload.translatedQuestionText)
    : (questionPayload.questionText || '');

  const options = (isHindi && (questionPayload.translatedHindiOptions || questionPayload.hindiOptions || questionPayload.translatedOptions))
    ? (questionPayload.translatedHindiOptions || questionPayload.hindiOptions || questionPayload.translatedOptions)
    : (Array.isArray(questionPayload.options) ? questionPayload.options : []);

  return formatQuestionForTTS(questionText, options, lang);
}
