// Workstream G — pinned Hindi terminology.
//
// WHY THIS EXISTS: two translation errors survived the register fix, and neither was a
// model-quality problem that a bigger model would fix.
//
//   "concave mirror" → वक्र दर्पण   (NCERT fixes this: अवतल दर्पण)
//   "playing audio"  → ऑडियो खेलने  (खेलना is play-a-game; audio is चलाना)
//
// The first is a term whose answer is DECIDED by the textbook the student reads — there
// is a right answer and the model does not get to pick. The second is an English
// homonym where the model chose the wrong sense. Neither improves on a stronger model,
// because neither is a fluency failure.
//
// This matters beyond the two strings: a glossary is DETERMINISTIC. Almost every other
// number in this repo is substrate-dependent and provisional (see PRODUCTION_CHECKLIST).
// A pinned termbase is not — it produces the same answer on 8b, on 70b, and on whatever
// replaces them.
//
// ── APPLICATION POINT: prompt injection, not post-translation substitution ──
//
// Post-substitution (translate, then string-replace wrong terms with right ones) is
// deterministic and tempting, and it is wrong for Hindi. Hindi inflects around the
// noun: अवतल दर्पण becomes अवतल दर्पण **से**, **का**, **में** depending on the
// postposition, and the surrounding verb and adjective agreement follows the noun's
// gender. Blind replacement of a translated term produces grammatically broken output —
// and broken Hindi read aloud is worse than a slightly-off term, because the student
// cannot parse it at all.
//
// So the glossary is injected into the prompt as an AUTHORITY LIST: "these terms have
// fixed translations, use exactly these". The model then inflects around them
// naturally. The cost is that it is advisory rather than guaranteed — a model can
// ignore it — which is the trade accepted here. If a term proves persistently ignored,
// the answer is to assert it in a test, not to switch to substitution.
//
// Only terms that ACTUALLY APPEAR in the source string are injected. Pushing 90 terms
// into every prompt would bury the register rules under a wall of vocabulary and cost
// tokens on every translation in the app.

/**
 * Terms whose Hindi is fixed by the NCERT Hindi textbook. The student has read these
 * words; a synonym — however elegant — is a word they have never seen.
 * Sourced from NCERT Hindi editions for the supported grades.
 */
export const NCERT_TERMS = {
  // Physics — light
  'concave mirror': 'अवतल दर्पण',
  'convex mirror': 'उत्तल दर्पण',
  'concave lens': 'अवतल लेंस',
  'convex lens': 'उत्तल लेंस',
  'plane mirror': 'समतल दर्पण',
  reflection: 'परावर्तन',
  refraction: 'अपवर्तन',
  dispersion: 'वर्ण-विक्षेपण',
  'focal length': 'फोकस दूरी',
  focus: 'फोकस',
  'principal axis': 'मुख्य अक्ष',
  image: 'प्रतिबिंब',
  'angle of incidence': 'आपतन कोण',
  'angle of reflection': 'परावर्तन कोण',
  'incident ray': 'आपतित किरण',
  'refractive index': 'अपवर्तनांक',

  // Physics — electricity & motion
  'electric current': 'विद्युत धारा',
  voltage: 'विभवांतर',
  'potential difference': 'विभवांतर',
  resistance: 'प्रतिरोध',
  circuit: 'परिपथ',
  conductor: 'चालक',
  velocity: 'वेग',
  acceleration: 'त्वरण',
  speed: 'चाल',
  force: 'बल',
  momentum: 'संवेग',
  mass: 'द्रव्यमान',
  weight: 'भार',
  work: 'कार्य',
  energy: 'ऊर्जा',

  // Chemistry
  atom: 'परमाणु',
  molecule: 'अणु',
  element: 'तत्व',
  compound: 'यौगिक',
  mixture: 'मिश्रण',
  valency: 'संयोजकता',
  'periodic table': 'आवर्त सारणी',
  metal: 'धातु',
  'non-metal': 'अधातु',
  acid: 'अम्ल',
  salt: 'लवण',
  'chemical reaction': 'रासायनिक अभिक्रिया',
  oxidation: 'ऑक्सीकरण',
  reduction: 'अपचयन',

  // Biology
  cell: 'कोशिका',
  tissue: 'ऊतक',
  organ: 'अंग',
  photosynthesis: 'प्रकाश संश्लेषण',
  respiration: 'श्वसन',
  digestion: 'पाचन',
  excretion: 'उत्सर्जन',
  reproduction: 'जनन',
  heredity: 'आनुवंशिकता',
  chromosome: 'गुणसूत्र',
  nucleus: 'केंद्रक',
  chlorophyll: 'पर्णहरित',
  stomata: 'रंध्र',
  nephron: 'वृक्काणु',
  neuron: 'तंत्रिका कोशिका',

  // Maths
  triangle: 'त्रिभुज',
  circle: 'वृत्त',
  radius: 'त्रिज्या',
  diameter: 'व्यास',
  chord: 'जीवा',
  tangent: 'स्पर्श रेखा',
  area: 'क्षेत्रफल',
  perimeter: 'परिमाप',
  probability: 'प्रायिकता',
  equation: 'समीकरण',
  polynomial: 'बहुपद',
  quadratic: 'द्विघात',
  median: 'माध्यिका',
  'right angle': 'समकोण',
  hypotenuse: 'कर्ण',
  'similar triangles': 'समरूप त्रिभुज',
  congruent: 'सर्वांगसम',
  'arithmetic progression': 'समांतर श्रेढ़ी'
};

/**
 * English words with more than one sense, where the model reliably picks the wrong one
 * in a school context. The gloss names the WRONG choice as well as the right one,
 * because "use X" alone does not stop a model that never considered X.
 */
export const HOMONYM_TERMS = {
  play: 'चलाना (audio/video sense — NOT खेलना, which means to play a game)',
  playing: 'चलाना (audio/video sense — NOT खेलना)',
  current: 'विद्युत धारा (electricity sense — NOT वर्तमान, which means present-time)',
  power: 'शक्ति (physics) or घात (exponent in maths) — NOT राज्य/सत्ता',
  volume: 'आयतन (3-D space) or ध्वनि तीव्रता (loudness) — NOT पुस्तक-खंड',
  table: 'सारणी (a table of data) — NOT मेज़, the furniture',
  degree: 'डिग्री (angle) or घात (degree of a polynomial)',
  solution: 'विलयन (chemistry) or हल (answer to a problem) — pick by context',
  right: 'समकोण in "right angle"; सही when it means correct',
  root: 'मूल (root of an equation) — NOT जड़, a plant root',
  base: 'क्षार (chemistry) or आधार (base of a triangle) — pick by context',
  mean: 'माध्य (average) — NOT मतलब, which means "signify"',
  second: 'सेकंड (unit of time) — NOT दूसरा, the ordinal',
  matter: 'पदार्थ (physical matter) — NOT मामला',
  cell: 'कोशिका (biology) or सेल (electric cell) — pick by context'
};

// Longest-first, so "concave mirror" is matched before "mirror" and "right angle"
// before "right". A shorter term winning would pin exactly the wrong word.
const ALL_TERMS = [...Object.entries(NCERT_TERMS), ...Object.entries(HOMONYM_TERMS)]
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Which glossary terms actually occur in this string?
 * Word-boundary matched and case-insensitive; a term already claimed by a longer
 * match is skipped so only the most specific entry is injected.
 */
export function glossaryFor(text) {
  if (!text || typeof text !== 'string') return [];
  const hay = text.toLowerCase();
  const out = [];
  const claimed = [];
  for (const [en, hi] of ALL_TERMS) {
    const re = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const m = re.exec(hay);
    if (!m) continue;
    const start = m.index;
    const end = start + en.length;
    if (claimed.some(([s, e]) => start >= s && end <= e)) continue;   // inside a longer term
    claimed.push([start, end]);
    out.push({ en, hi });
  }
  return out;
}

/** Render the matched terms as a prompt block, or '' when nothing matched. */
export function glossaryPromptBlock(text) {
  const terms = glossaryFor(text);
  if (!terms.length) return '';
  return '\n\nFIXED TERMINOLOGY — these words have settled Hindi translations. Use EXACTLY these, and inflect the sentence around them naturally:\n'
    + terms.map(({ en, hi }) => `- "${en}" → ${hi}`).join('\n');
}
