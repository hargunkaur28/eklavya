// Workstream D — figure/diagram questions.
//
// Approach (D1): Groq emits the figure as INLINE SVG alongside the question. No
// image-search API: search results are copyrighted, frequently mislabelled, and
// the free tiers are far too small. Generated SVG is free, always matches the
// question, is a few KB of text, scales to any screen, and can be recoloured for
// dark mode.
//
// Security (D2): model-generated SVG is EXECUTABLE and is treated as hostile.
// Everything below is an allow-list: unknown tags and unknown attributes are
// dropped, not escaped. The client renders the result as a data-URI <img>, which
// does not execute scripts — so sanitisation failure is not a single point of
// failure. If a figure cannot be produced safely we drop it and keep the question
// text-only; a question without a figure is acceptable, a broken or unsafe figure
// is not.

import sanitizeHtml from 'sanitize-html';
import { callGroqChat, callOpenAIChat } from './groqClient.js';


import { subjectScopeLabel } from '../config/taxonomy.js';

// ── THIS PATH DELIBERATELY PREFERS OPENAI. DO NOT "HARMONISE" IT. ───────────
//
// Everywhere else in this app calls Groq first and falls back to OpenAI. Diagram
// generation inverts that, on purpose:
//
//   - It is LOW VOLUME. A module quiz makes a few calls; the rest of the app makes
//     one per question, per lesson, per translation, per narration.
//   - The output is TINY (~1KB of SVG), so the per-call cost is negligible.
//   - It is the ONE task here that needs genuine SPATIAL reasoning. Laying out a
//     labelled cross-section is not text generation, and the difference between
//     models shows up immediately: the 8b fallback produced four labels stacked
//     inside an empty oval — valid SVG, correct viewBox, under the cap, sanitising
//     clean, alt text present, and teaching nothing.
//
// That makes it the highest quality-per-rupee use of the paid key. Groq remains the
// fallback so an OpenAI outage degrades to a worse figure rather than none.
//
// NOT the cheapest tier: gpt-4o-mini is what the app-wide chain already falls back to
// and is not markedly better at spatial layout. Volume is low enough that quality is
// the right optimisation.
export const DIAGRAM_MODEL = 'gpt-4o';

// Outlier guard for the general case. MEASURED real output is ~550 bytes
// (min 402, avg 547, max 619 across circles / solids / circuits), so 50KB is a
// runaway backstop, not a typical size.
const MAX_SVG_BYTES = 50 * 1024;
export const MAX_SVG_BYTES_EXPORT = MAX_SVG_BYTES;   // for the size-baseline measurement

// Tighter cap for figures that get CACHED on a Roadmap day (Feature 9 module
// quizzes). The mean is not the risk — the tail is: at 50KB a pathological figure
// times ~4 per day times 15 days would put 3MB of SVG inside a single Roadmap
// document that already holds lesson prose, questions, attempts and video progress,
// against MongoDB's 16MB BSON limit. At 8KB the same worst case is 480KB (~3%), and
// since real figures are ~550 bytes it rejects nothing that actually occurs.
export const CACHED_SVG_MAX_BYTES = 8 * 1024;

// Roughly 30-40% of questions on a diagram-eligible chapter carry a figure. The
// model may also decline (returning no figure when the text is self-sufficient),
// which pushes the real rate a little lower — that is the intended direction.
const DIAGRAM_SHARE = 0.35;

// Hard ceiling on how long a figure may hold up a question. Diagram generation is
// a Groq call that can take several seconds (longer when the provider is degraded),
// and the question is required to be answerable from its text alone — so a slow
// figure is dropped rather than allowed to extend the wait between rounds.
const DIAGRAM_TIMEOUT_MS = 7000;

// D2 allow-list. `script`, `foreignObject`, `image`, `use`, `style`, `a` and every
// `animate*` element are absent by construction.
const ALLOWED_TAGS = [
  'svg', 'g', 'defs', 'marker', 'title', 'desc',
  'path', 'circle', 'line', 'rect', 'polygon', 'polyline', 'ellipse',
  'text', 'tspan'
];

const PRESENTATION_ATTRS = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity',
  'opacity', 'transform', 'class', 'style', 'id'
];

// SVG is XML — case-sensitive. sanitize-html parses as HTML and lowercases names
// unless told not to; even with lowercasing off, a model may emit `viewbox`. Both
// paths converge in restoreCamelCaseAttrs so the stored string is always valid XML
// for an <img>.
const CAMEL_ATTRS = [
  'viewBox', 'preserveAspectRatio', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'markerUnits', 'textLength', 'lengthAdjust', 'gradientUnits', 'patternUnits',
  'clipPathUnits', 'startOffset', 'baseProfile'
];

// Because attribute-name lowercasing is disabled (so `viewBox` survives), the
// allow-list is matched case-sensitively — which would silently drop a model's
// lowercase `viewbox` and make an otherwise fine figure fail the viewBox check.
// Allow both spellings through; restoreCamelCaseAttrs normalises them afterwards.
const withLowercaseVariants = (attrs) => [
  ...new Set(attrs.flatMap((a) => (CAMEL_ATTRS.includes(a) ? [a, a.toLowerCase()] : [a])))
];

const ALLOWED_ATTRS_RAW = {
  svg: ['viewBox', 'xmlns', 'preserveAspectRatio', 'role', 'aria-label', ...PRESENTATION_ATTRS],
  g: [...PRESENTATION_ATTRS],
  defs: ['id'],
  marker: ['id', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', ...PRESENTATION_ATTRS],
  title: [],
  desc: [],
  path: ['d', ...PRESENTATION_ATTRS, 'marker-end', 'marker-start', 'marker-mid'],
  circle: ['cx', 'cy', 'r', ...PRESENTATION_ATTRS],
  line: ['x1', 'y1', 'x2', 'y2', ...PRESENTATION_ATTRS, 'marker-end', 'marker-start'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...PRESENTATION_ATTRS],
  polygon: ['points', ...PRESENTATION_ATTRS],
  polyline: ['points', ...PRESENTATION_ATTRS, 'marker-end', 'marker-start'],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...PRESENTATION_ATTRS],
  text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight', 'font-style', 'textLength', 'lengthAdjust', ...PRESENTATION_ATTRS],
  tspan: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-weight', 'font-style', 'baseline-shift', ...PRESENTATION_ATTRS]
};

const ALLOWED_ATTRS = Object.fromEntries(
  Object.entries(ALLOWED_ATTRS_RAW).map(([tag, attrs]) => [tag, withLowercaseVariants(attrs)])
);

function restoreCamelCaseAttrs(svg) {
  let out = svg;
  for (const attr of CAMEL_ATTRS) {
    out = out.replace(new RegExp(`\\s${attr}\\s*=`, 'gi'), ` ${attr}=`);
  }
  return out;
}

// Minimal XML well-formedness check — tags balanced, no stray '<'. Enough to
// catch a truncated or hallucinated document without pulling in a parser.
function isWellFormedXml(svg) {
  const stack = [];
  const tagRe = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
  let match;
  let consumed = 0;
  while ((match = tagRe.exec(svg)) !== null) {
    const [full, closing, name, attrs] = match;
    consumed += full.length;
    const selfClosing = /\/\s*$/.test(attrs);
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClosing) {
      stack.push(name);
    }
  }
  if (stack.length) return false;
  // Any '<' that was not part of a recognised tag means the document is malformed.
  const textOnly = svg.replace(tagRe, '');
  if (textOnly.includes('<') || textOnly.includes('>')) return false;
  return consumed > 0;
}

// ── Does the figure actually DEPICT anything? ──────────────────────────────
//
// Every existing check is about SAFETY and WELL-FORMEDNESS: allow-listed elements, a
// viewBox, balanced XML, under the size cap, alt text present. A cell-nucleus figure
// passed all of them while consisting of four labels stacked inside an empty oval —
// no envelope, no nucleolus, no chromatin, no leader lines. Safe, valid, and it taught
// nothing.
//
// This ships REGARDLESS of the model change. A stronger model makes label-only output
// rarer; it does not make it impossible, and "rarer" is not a property you can cache
// for the life of a roadmap. Same rule as everywhere else in this build: enforced, not
// hoped for.
const DRAWING_ELEMENTS = ['path', 'circle', 'line', 'rect', 'polygon', 'polyline', 'ellipse'];

// Runaway ceiling. Real figures measured on this path carry 4-16 drawn shapes; the
// largest legitimate one seen is 16. A response captured mid-failure contained
// **249 <line> elements and zero labels**, bouncing between the same four coordinates
// — the model stuck in a repetition loop, not drawing detail.
//
// That matters for more than tidiness. The runaway is what was blowing the token
// ceiling: raising maxTokens from 4000 to 8000 only moved where the loop got cut off
// (11.7 KB -> 23.5 KB of JSON), which is why the truncation never went away. The
// ceiling was treating a symptom. 60 is ~4x the largest real figure, so it rejects
// degenerate output without constraining a genuinely detailed one.
const MAX_DRAWING_ELEMENTS = 60;

const countTag = (svg, tag) => (svg.match(new RegExp(`<\\s*${tag}\\b`, 'gi')) || []).length;

/**
 * Reject a figure that labels without drawing. Returns { ok, reason, detail, stats }.
 *
 * The thresholds are deliberately crude — this is a floor, not a judgement of quality.
 * It catches the specific failure that shipped, and anything worse.
 */
export function validateDepiction(svg) {
  if (!svg || typeof svg !== 'string') return { ok: false, reason: 'DEPICTS_NOTHING', detail: 'no svg' };

  const texts = countTag(svg, 'text');
  const drawings = DRAWING_ELEMENTS.reduce((n, t) => n + countTag(svg, t), 0);
  // Leaders are <line>/<polyline>. They are also drawing elements, which is fine: the
  // question here is only whether ANY exist to connect a label to a part.
  const leaders = countTag(svg, 'line') + countTag(svg, 'polyline');
  const stats = { texts, drawings, leaders };

  // Nothing drawn at all — the strongest form of the bug.
  if (drawings === 0) {
    return { ok: false, reason: 'DEPICTS_NOTHING', detail: `${texts} label(s), 0 drawn shapes`, stats };
  }
  // More labels than shapes: parts are being NAMED rather than DRAWN.
  if (texts > drawings) {
    return { ok: false, reason: 'LABEL_ONLY_FIGURE', detail: `${texts} label(s) vs ${drawings} drawn shape(s)`, stats };
  }
  // Labels with no leader lines: text floating in the figure is not a label.
  if (texts >= 2 && leaders === 0) {
    return { ok: false, reason: 'NO_LEADER_LINES', detail: `${texts} label(s), no line/polyline leader`, stats };
  }
  // "Interpretable with every <text> removed" approximated mechanically: a single
  // outline with labels inside is exactly the nucleus figure that started this.
  if (texts >= 3 && drawings < 3) {
    return { ok: false, reason: 'TOO_FEW_PARTS_DRAWN', detail: `${texts} label(s) but only ${drawings} shape(s)`, stats };
  }
  // Degenerate repetition. Checked AFTER the label rules so the more informative
  // reason wins when a figure is both label-poor and enormous.
  if (drawings > MAX_DRAWING_ELEMENTS) {
    return { ok: false, reason: 'DEGENERATE_REPETITION', detail: `${drawings} drawn elements (ceiling ${MAX_DRAWING_ELEMENTS})`, stats };
  }
  return { ok: true, stats };
}

/**
 * Sanitise model-generated SVG. Returns a safe SVG string, or null if the input
 * cannot be made safe (the caller then drops the figure).
 */
export function sanitizeSvg(raw, maxBytes = MAX_SVG_BYTES) {
  return sanitizeSvgDetailed(raw, maxBytes).svg;
}

/**
 * Same sanitisation, but reports WHICH STAGE dropped the figure.
 *
 * Added because a NEET Biology nephron prompt produced no diagram and there was no
 * way to tell from outside whether the model declined, the XML failed to parse, the
 * allow-list stripped it below viability, or it blew the size cap. Biology
 * cross-sections are exactly where figures matter most, so a silent drop there means
 * an entire course quietly gets none. One line of instrumentation turns a permanent
 * mystery into a fixable bug.
 */
export function sanitizeSvgDetailed(raw, maxBytes = MAX_SVG_BYTES) {
  const fail = (reason, detail) => ({ svg: null, reason, detail });
  if (typeof raw !== 'string') return fail('NOT_A_STRING');

  let svg = raw.trim();
  // Unwrap a fenced code block if the model added one.
  svg = svg.replace(/^```(?:svg|xml|html)?\s*/i, '').replace(/```\s*$/, '').trim();
  // Drop anything before the root element (XML declaration, DOCTYPE, prose).
  const start = svg.indexOf('<svg');
  const end = svg.lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) return fail('NO_SVG_ROOT', String(raw).slice(0, 60));
  svg = svg.slice(start, end + '</svg>'.length);

  if (Buffer.byteLength(svg, 'utf8') > maxBytes) return fail('OVER_SIZE_CAP_BEFORE_CLEAN', Buffer.byteLength(svg, 'utf8') + 'B > ' + maxBytes + 'B');

  let clean;
  try {
    clean = sanitizeHtml(svg, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: ALLOWED_ATTRS,
      // No schemes are permitted anywhere: there are no href-bearing tags in the
      // allow-list, so any URL reference is by definition an external reference.
      allowedSchemes: [],
      allowedSchemesAppliedToAttributes: [],
      allowProtocolRelative: false,
      parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
      // Comments and CDATA can smuggle markup past naive downstream handling.
      allowedScriptDomains: [],
      disallowedTagsMode: 'discard',
      transformTags: {
        // Fixed width/height defeat responsive rendering; viewBox is what scales.
        svg: (tagName, attribs) => {
          const { width, height, ...rest } = attribs;
          return { tagName, attribs: rest };
        }
      }
    });
  } catch (err) {
    return fail('SANITISER_THREW', err.message);
  }

  clean = restoreCamelCaseAttrs(clean).trim();
  if (!clean || !/^<svg[\s>]/i.test(clean)) return fail('NO_SVG_AFTER_CLEAN');

  // Defence in depth: even though the allow-list should make these unreachable,
  // reject outright if any of them survived rather than trying to patch them out.
  if (/\son[a-z]+\s*=/i.test(clean)) return fail('EVENT_HANDLER_SURVIVED');                 // event handlers
  if (/javascript\s*:/i.test(clean)) return fail('JAVASCRIPT_URI');
  if (/data\s*:/i.test(clean)) return fail('DATA_URI');
  if (/url\s*\(/i.test(clean)) return fail('URL_REFERENCE');                       // style url() refs
  if (/<\s*(script|foreignObject|image|use|animate|set|iframe)/i.test(clean)) return fail('FORBIDDEN_ELEMENT_SURVIVED');
  if (/xlink:href|(?<![a-z])href\s*=/i.test(clean)) return fail('EXTERNAL_REF');  // external refs

  // viewBox is mandatory — without it the figure cannot scale.
  const viewBox = clean.match(/\sviewBox\s*=\s*"([^"]*)"/i);
  if (!viewBox || !/^[\s\d.,+-]+$/.test(viewBox[1]) || viewBox[1].trim().split(/[\s,]+/).length !== 4) return fail('NO_VALID_VIEWBOX');

  if (!isWellFormedXml(clean)) return fail('MALFORMED_XML');

  // Empty after sanitisation — a bare <svg></svg> with nothing drawn is not a figure.
  const body = clean.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>$/i, '').trim();
  if (!body) return fail('EMPTY_AFTER_SANITISE');

  // Guarantee the XML namespace so the data-URI renders standalone.
  if (!/xmlns\s*=/.test(clean)) {
    clean = clean.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  return Buffer.byteLength(clean, 'utf8') > maxBytes
    ? fail('OVER_SIZE_CAP_AFTER_CLEAN', Buffer.byteLength(clean, 'utf8') + 'B > ' + maxBytes + 'B')
    : { svg: clean, reason: null };
}

function buildDiagramPrompt({ grade, scope, chapterName, questionText, options, strict }) {
  return `A student in "${grade}" studying "${scope}" is answering this ${chapterName ? `"${chapterName}" ` : ''}question:

QUESTION: ${questionText}
OPTIONS: ${JSON.stringify(options || [])}

Decide whether this question REQUIRES a figure to be answerable. If the question is fully answerable from its text alone, it does not need one.
${strict ? '\nYOUR PREVIOUS SVG WAS REJECTED. Most likely it only LABELLED parts instead of DRAWING them, had no leader lines, was missing a viewBox, or used a disallowed element. Draw the actual structure this time.\n' : ''}
Return ONLY JSON:
{ "needed": true, "svg": "<svg viewBox=\\"0 0 400 300\\">...</svg>", "alt": "One sentence describing the figure for a student who cannot see it." }
or
{ "needed": false }

THE FIGURE MUST DEPICT THE STRUCTURE. This is the rule that matters most:
- Every part you name MUST BE DRAWN as its own shape — a circle, path, ellipse, line or polygon. Writing a part's name inside an outline is NOT drawing it.
- The figure must still be interpretable with EVERY <text> element deleted. If removing the text leaves nothing recognisable, the figure has failed and will be discarded.
- Labels go OUTSIDE the figure, connected to the part they name by a <line> or <polyline> LEADER. Text floating inside a shape is not a label.
- You need at least as many drawn shapes as labels. Four labels inside one empty oval is the exact failure this rule exists to prevent.

WORKED EXAMPLE — a correct labelled biological figure (an animal cell):
<svg viewBox="0 0 400 300">
  <ellipse cx="190" cy="150" rx="120" ry="90" stroke="currentColor" fill="none" stroke-width="2"/>
  <circle cx="180" cy="145" r="42" stroke="currentColor" fill="none" stroke-width="2"/>
  <circle cx="180" cy="145" r="14" stroke="currentColor" fill="none" stroke-width="2"/>
  <path d="M120 190 q20 -18 42 -4 q22 14 40 -2" stroke="currentColor" fill="none" stroke-width="2"/>
  <line x1="310" y1="90" x2="222" y2="120" stroke="currentColor" stroke-width="1"/>
  <text x="314" y="88" font-size="14">Cell membrane</text>
  <line x1="330" y1="150" x2="222" y2="147" stroke="currentColor" stroke-width="1"/>
  <text x="334" y="154" font-size="14">Nucleus</text>
  <line x1="120" y1="60" x2="174" y2="132" stroke="currentColor" stroke-width="1"/>
  <text x="30" y="56" font-size="14">Nucleolus</text>
  <line x1="70" y1="235" x2="140" y2="196" stroke="currentColor" stroke-width="1"/>
  <text x="14" y="250" font-size="14">Endoplasmic reticulum</text>
</svg>
Note what makes it correct: the membrane, nucleus, nucleolus and reticulum are each a DRAWN shape; every label sits outside with a leader line to its part; and deleting every <text> still leaves a recognisable cell.

SVG rules — a figure that breaks any of these is discarded:
- Use ONLY these elements: svg, g, defs, marker, path, circle, line, rect, polygon, polyline, ellipse, text, tspan.
- NEVER use script, foreignObject, image, use, style elements, animations, event handlers, or any external reference/URL.
- A "viewBox" attribute on the root <svg> is MANDATORY. Do NOT set width or height attributes.
- Line work must use stroke="currentColor" and fill="none" so it inherits the page theme. Use an explicit colour ONLY where the question depends on it (for example a red wire).
- <text> at font-size 14 or larger.
- The figure MUST NOT give away the answer. If the question asks for an angle, a length or a value, do not label that quantity in the figure.
- Coordinates must actually form the shape described. Draw the detail the structure needs — do not simplify it away to save space.
- "alt" is one plain sentence, no markup, describing what is drawn and what is labelled.

Raw JSON only, no markdown.`;
}

/**
 * Generate a figure for one question. Regenerates once on rejection, then gives up
 * and keeps the question text-only.
 *
 * Returns a DISCRIMINATED result, not a bare null, because the caller has to tell two
 * outcomes apart that both mean "no figure":
 *
 *   declined — the model read the question and judged a figure unnecessary. A
 *              DECISION about this question, and it will not change on a retry.
 *   failed   — the call errored, or two attempts produced nothing that survived
 *              sanitisation. Says nothing about whether a figure is warranted.
 *
 * Collapsing both into `null` made a 429 permanent: the caller stamped
 * `diagramAttempted = true` on it, which is the terminal state, so a transient
 * provider blip cost that cached question its figure for the life of the roadmap —
 * the exact failure this workstream's retry path exists to prevent. The
 * `lastDropReason` variable below was already being assigned and never read; the
 * intent was there and the value never reached anyone who could act on it.
 */
export async function generateDiagramFor(question, { grade, subject, subSubject, chapterName, maxBytes }) {
  const scope = subjectScopeLabel(subject, subSubject);

  let lastDropReason = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let data;
    try {
      const messages = [
        { role: 'system', content: 'You draw precise, anatomically/geometrically correct labelled SVG figures for exam questions. Every part you name must be drawn. Output raw JSON only.' },
        {
          role: 'user',
          content: buildDiagramPrompt({
            grade, scope, chapterName,
            questionText: question.questionText,
            options: question.options,
            strict: attempt > 0
          })
        }
      ];
      // OPENAI FIRST — see DIAGRAM_MODEL at the top of this file for why this path
      // inverts the app-wide chain. Groq is the fallback, so an OpenAI outage yields a
      // worse figure rather than none. `maxTokens` is generous because a figure that
      // genuinely draws its parts is longer than one that only labels them. At 4000 the
      // optics figures were TRUNCATED mid-JSON ("Unterminated string at position 11732"),
      // which surfaces as GENERATION_CALL_FAILED and misattributes the cause — and
      // biases any size measurement downward, because the biggest figures are the ones
      // that fail. 8000 leaves room for a detailed cross-section.
      const raw = await callOpenAIChat(messages, {
        model: DIAGRAM_MODEL, temperature: 0.2, jsonMode: true, maxTokens: 8000
      }) || await callGroqChat(messages, { jsonMode: true, temperature: 0.2, maxTokens: 8000 });
      data = JSON.parse(raw);
    } catch (err) {
      lastDropReason = 'GENERATION_CALL_FAILED';
      console.warn('Diagram dropped [GENERATION_CALL_FAILED]:', err.message);
      continue;
    }

    if (!data || data.needed !== true) {
      console.warn('Diagram dropped [MODEL_DECLINED] — it judged the question self-sufficient.');
      return { status: 'declined', diagram: null };
    }

    const { svg, reason, detail } = sanitizeSvgDetailed(data.svg, maxBytes);
    const alt = typeof data.alt === 'string' ? data.alt.trim().slice(0, 400) : '';

    if (svg && alt) {
      // Sanitised and well-formed is not the same as USEFUL. Checked here, after
      // sanitisation, because sanitisation can itself strip a figure down to labels.
      const depiction = validateDepiction(svg);
      if (depiction.ok) return { status: 'ok', diagram: { svg, alt, altHindi: '' } };
      lastDropReason = depiction.reason;
      console.warn(`Diagram rejected on attempt ${attempt + 1} [${depiction.reason}] — ${depiction.detail}.`);
      continue;   // the strict retry names the depiction failure explicitly
    }

    lastDropReason = reason || (svg ? 'MISSING_ALT_TEXT' : 'FAILED_SANITISATION');
    console.warn(`Diagram rejected on attempt ${attempt + 1} [${lastDropReason}]${detail ? ` — ${detail}` : ''}.`);
  }

  // Both attempts exhausted without a decision. Retryable, NOT terminal.
  return { status: 'failed', diagram: null, reason: lastDropReason };
}

/**
 * Record one generation outcome on a question, in place.
 *
 * Pulled out of attachDiagrams as a pure function on purpose: the bug this encodes
 * against was a DECISION RULE, not a network problem, and testing it through a live
 * model proved useless — the provider can rate-limit mid-run, and a second attempt is
 * free to decline where the first errored, so the same input yields different
 * outcomes. Exported so the rule can be asserted directly for all four cases.
 *
 * `diagramAttempted` is stamped ONLY on an outcome that cannot change:
 *   ok       -> figure attached; done
 *   declined -> the model judged none needed; terminal, never retried
 *   failed   -> call errored or nothing survived sanitisation; retryable
 *   timeout  -> not a decision at all; retryable
 */
export function applyDiagramResult(question, result) {
  if (!question) return question;
  if (result?.status === 'ok' && result.diagram) {
    question.diagram = result.diagram;
    question.diagramAttempted = true;
  } else if (result?.status === 'declined') {
    question.diagramAttempted = true;
  }
  // 'failed', 'timeout' and anything unrecognised deliberately leave
  // diagramAttempted untouched, which is what makes them retry-eligible.
  return question;
}

/**
 * Attach figures to a batch of questions, in place.
 *
 * Only questions whose chapter is `diagramEligible` are considered (D3), and only
 * about a third of those — a figure forced into every question is noise. The model
 * still has the final say on necessity.
 */
export async function attachDiagrams(questions, {
  grade, subject, subSubject, chapters = [], maxBytes, share = DIAGRAM_SHARE,
  // Overrides the per-question chapter lookup. Practice mode has no trustworthy
  // chapter (its topic is free text from the student) and has already gated at
  // SUBJECT level via subjectDiagramEligible, so it passes a predicate rather than
  // being handed a fabricated chapter record it would then store as if it were real.
  isEligible = null,
  // Chapter name for the prompt when there is no resolved chapter to take it from.
  topicLabel = '',
  // For callers that CACHE the result. Only about a third of eligible questions are
  // ever picked to carry a figure; the rest are skipped on purpose. Without this flag
  // those unpicked questions are indistinguishable from ones whose generation failed,
  // so a retry pass grabs them all — which both mutates a quiz that is supposed to be
  // fixed at generation time and, fetch by fetch, drives the figure rate to 100% and
  // defeats the share. For a cached artefact the sampling decision IS final, so it is
  // recorded as one.
  finalizeUnselected = false
}) {
  if (!Array.isArray(questions) || !questions.length) return questions;

  const byId = new Map(chapters.map((c) => [c.id, c]));
  const eligibleFn = isEligible || ((q) => !!byId.get(q.chapterId)?.diagramEligible);
  const eligible = questions.filter((q) => q.type !== 'written' && eligibleFn(q));
  if (!eligible.length) {
    if (finalizeUnselected) questions.forEach((q) => { if (q.type !== 'written') q.diagramAttempted = true; });
    return questions;
  }

  // At least one candidate per batch. A diagnostic round is only 4 questions, so a
  // pure `round(n * 0.35)` floors to zero whenever a round happens to contain a
  // single eligible chapter — which is most rounds, meaning figures would never
  // appear at all. The model still declines when the text is self-sufficient, so
  // this sets the ceiling on candidates, not the actual figure rate.
  const target = Math.max(1, Math.round(eligible.length * share));

  // Spread the picks across the batch rather than always taking the first N.
  const picks = [];
  for (let i = 0; i < target; i++) {
    picks.push(eligible[Math.floor((i * eligible.length) / target)]);
  }

  // Record the not-picked questions as settled BEFORE any generation runs, so a
  // caller that caches never confuses "the share skipped this one" with "this one's
  // figure failed and should be retried".
  if (finalizeUnselected) {
    const picked = new Set(picks);
    questions.forEach((q) => { if (q.type !== 'written' && !picked.has(q)) q.diagramAttempted = true; });
  }

  // A figure is a nice-to-have on a question that must be answerable from its text
  // alone, so it is never worth making the student wait for. Whatever has not
  // arrived by the deadline is dropped and the question ships text-only.
  const deadline = new Promise((resolve) => setTimeout(() => resolve('timeout'), DIAGRAM_TIMEOUT_MS));

  await Promise.all([...new Set(picks)].map(async (q) => {
    try {
      const result = await Promise.race([
        generateDiagramFor(q, { grade, subject, subSubject, chapterName: byId.get(q.chapterId)?.name || topicLabel, maxBytes }),
        deadline
      ]);
      if (result === 'timeout') {
        console.warn(`attachDiagrams: figure timed out after ${DIAGRAM_TIMEOUT_MS}ms — question ships text-only.`);
      }
      applyDiagramResult(q, result);
    } catch (err) {
      console.warn('attachDiagrams: skipping figure for one question —', err.message);
    }
  }));

  return questions;
}
// ── Orphaned figure-reference guard ─────────────────────────────────────────
//
// A question that says "in the figure below" with no figure is unanswerable, and if
// it reaches a CACHED module quiz it is served that way forever — the daily-lesson
// bug in a new location, which was the most damaging thing found in Workstream A.
//
// This is deliberately a VALIDATION RULE rather than a checklist note. A rule written
// as prose erodes; a rule that rejects the question cannot be forgotten. It sits
// alongside the existing rejections for "prove that" stems and near-duplicate options.
//
// Hindi is included because a translated question travels the same caching path, and
// a Devanagari figure reference is exactly as orphaned as an English one.
const FIGURE_REFERENCE_RE = new RegExp([
  // English
  'in the (figure|diagram|image|picture)',
  'the (figure|diagram) (below|above|shown)',
  '(shown|given) (in the )?(figure|diagram|below|above)',
  'from the (figure|diagram|graph)',
  'refer to the (figure|diagram)',
  'according to the (figure|diagram)',
  '(figure|diagram) below',
  'as shown',
  'the adjoining (figure|diagram)',
  // Hindi — a translated question hits the same path
  'चित्र में',
  'दिए गए चित्र',
  'नीचे दिए गए चित्र',
  'आकृति में',
  'दी गई आकृति',
  'चित्र के अनुसार',
  'चित्रानुसार'
].join('|'), 'i');

/**
 * Does this question text refer to a figure?
 * Exported so quiz generators can reject an orphaned reference before caching.
 */
export function referencesAFigure(text) {
  return FIGURE_REFERENCE_RE.test(String(text || ''));
}

/**
 * True when a question is UNSAFE TO CACHE: it points at a figure it does not have.
 *
 * Callers must regenerate or drop such a question rather than storing it. Note the
 * asymmetry — a question WITH a diagram that never mentions it is fine (the figure is
 * supporting context); a question WITHOUT one that mentions it is broken.
 */
export function hasOrphanedFigureReference(question) {
  if (!question) return false;
  const hasDiagram = !!question.diagram?.svg;
  if (hasDiagram) return false;
  return referencesAFigure(question.questionText || question.question)
    || referencesAFigure(question.translatedHindiQuestionText);
}

/**
 * Filter a batch before caching. Returns { safe, dropped } so the caller can log what
 * it discarded instead of silently shrinking the quiz.
 */
export function rejectOrphanedFigureQuestions(questions) {
  const safe = [];
  const dropped = [];
  for (const q of questions || []) (hasOrphanedFigureReference(q) ? dropped : safe).push(q);
  if (dropped.length) {
    console.warn(
      `Dropped ${dropped.length} question(s) referencing a figure that was not generated ` +
      '— they would have cached as unanswerable.'
    );
  }
  return { safe, dropped };
}

// ── Transient failure must not become permanent ─────────────────────────────
//
// Diagram generation fails TRANSIENTLY — the nephron figure dropped once on a 429
// and then succeeded twice on retry. Feature 9 caches a module quiz ONCE and serves
// it for the life of the roadmap, so a 429 during the cache write means that day has
// no figures forever, on a perfectly valid question in a diagram-eligible chapter.
// Nothing surfaces it: the student just gets a Circles day with no circle.
//
// This is NOT the orphan bug — the question is self-consistent, so
// rejectOrphanedFigureQuestions() correctly passes it. It is the daily-lesson bug's
// other half: absent content cached as though it were final.
//
// Two booleans give three states, which is what distinguishes "done" from "never
// tried":
//   diagramAttempted = true,  diagram present  -> done
//   diagramAttempted = true,  no diagram       -> the model judged none needed; NEVER retry
//   diagramAttempted = false                   -> not tried, or generation errored; retry ONCE
//
// So a chapter that genuinely needs no figure is never hammered, and a 429 costs one
// extra call on the next day view rather than a permanently figure-less quiz.
export const DIAGRAM_SHARE_MODULE_QUIZ = 0.35;

// Practice mode regenerates EVERY session, so diagram cost is never amortised — the
// same ten questions pay for figures again on every attempt. On a rate-limited key
// that is the difference between a practice quiz taking ~8s and ~30s. Lower share
// here is a deliberate trade: practice is for volume and repetition, module quizzes
// are the once-per-day artefact worth spending on.
export const DIAGRAM_SHARE_PRACTICE = 0.2;

// The SUBJECT-level figure gate is NOT defined here. It is
// `subjectDiagramEligible()` in `src/config/taxonomy.js`, which already existed for
// exactly this purpose, is mirrored to the client, and is drift-guarded by CI
// invariant 7.
//
// A blueprint-derived version was written here first ("does this subject contain any
// diagramEligible chapter?"), which read as the more principled choice and was not:
// the blueprint only covers the exam grades, so it returned false for all 135
// grade/subject identities outside Class 10-12 and would have silently disabled
// figures for, say, Class 6 Maths practice. Deriving a subject-level answer from a
// chapter-level table also builds a second gate that can disagree with the declared
// one — the parallel taxonomy the project rules exist to prevent. CI invariant 8 now
// fails the build if that definition reappears outside taxonomy.js.

/**
 * Should this cached question get another diagram attempt on the next fetch?
 * True ONLY for the "never actually tried" state.
 */
export function needsDiagramRetry(question, chaptersById, subjectEligible = false) {
  if (!question || question.type === 'written') return false;
  if (question.diagram?.svg) return false;          // already has one
  if (question.diagramAttempted === true) return false; // tried; model said no figure
  const ch = chaptersById?.get?.(question.chapterId);
  if (ch) return !!ch.diagramEligible;              // chapter known — it decides
  // No chapter row: either a course the blueprint does not cover, or a question
  // cached before chapterId existed. Falling back to `false` here would make the
  // retry unreachable for exactly the lower grades whose figures now come from the
  // subject-level gate — the same "missing row read as a decision" mistake the
  // generate path had. The caller passes the subject verdict so the two agree.
  return !!subjectEligible;
}
