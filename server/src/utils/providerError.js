// Design Rule 2, generalised: a caller that discards a provider's error body cannot
// distinguish a TERMINAL state from a RETRYABLE one, and will treat them identically —
// in whichever direction the code happens to lean.
//
// This module is the one place that reads the body and makes that call.
//
// WHY IT IS SHARED RATHER THAN INLINE. It was written inline in `openaiTts.js` first,
// and by the time a second and third call site needed it there would have been three
// copies of a classification that must not disagree. That is the exact shape of the
// bug `sourceScan.js` exists to prevent: a correct thing implemented in ONE place does
// not protect the places that do not call it. A classifier that says "terminal" in one
// file and "retryable" in another is worse than either answer applied consistently.
//
// It also makes the decision TESTABLE. `classifyProviderError` is pure, so
// "an exhausted quota is never retryable" is asserted directly (CI invariant 20)
// rather than being a property of three regexes scattered across the codebase.

// ── The terminal signals ────────────────────────────────────────────────────
//
// Vocabulary differs per provider, so this matches on what they actually emit rather
// than on a single documented field. All three of OpenAI, Groq and Sarvam return 429
// for both "too fast" and "out of money", and only the body says which.
//
// The `code`/`type` fields are the reliable half. The message substrings are the
// belt-and-braces half, for providers that return prose without a machine-readable
// type — matched case-insensitively against the message ONLY, never against the whole
// body, so a request id that happens to contain "quota" cannot trip it.
const TERMINAL_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'billing_hard_limit_reached',
  'account_deactivated',
  'invalid_api_key',
  'account_not_active'
]);

const TERMINAL_MESSAGE_HINTS = [
  'no credits remaining',
  'insufficient quota',
  'exceeded your current quota',
  'billing',
  'add credits',
  'subscription',
  'account is not active'
];

/**
 * Classify a provider's error response.
 *
 * @param {Response} res    the failed fetch Response (never re-read; the body is
 *                          consumed here exactly once)
 * @param {string} label    provider/call name for the log line
 * @returns {Promise<{status:number, type:string, code:string, message:string,
 *                    terminal:boolean, summary:string}>}
 *
 * `terminal: true` means RETRYING CANNOT HELP — the key has no credits, is revoked, or
 * the account is off. Fail fast; do not back off, do not queue, do not try the next
 * model on the same key.
 *
 * `terminal: false` means the state may change on its own. Back off and retry.
 *
 * Never throws. A body that cannot be read or parsed yields `terminal: false`, which is
 * the SAFE lean of the two and is a deliberate choice: wrongly calling a transient
 * failure terminal loses content that would have arrived (the original Rule 2 defect,
 * where one 429 cost a cached question its figure permanently), whereas wrongly calling
 * an exhausted key retryable costs some pointless backoff. Both are wrong; only one
 * destroys something.
 */
export async function classifyProviderError(res, label = 'provider') {
  const status = res?.status ?? 0;
  let type = '';
  let code = '';
  let message = '';
  let raw = '';

  try {
    raw = await res.text();
  } catch {
    raw = '';
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const e = parsed?.error || parsed || {};
      type = String(e.type || '');
      code = String(e.code || e.error_code || '');
      message = String(e.message || parsed?.message || '');
    } catch {
      // Not JSON — some providers return HTML on a gateway error. Keep a bounded
      // slice as the message so there is still something to grep for.
      message = raw.slice(0, 300);
    }
  }

  const hay = message.toLowerCase();
  const terminal =
    TERMINAL_CODES.has(code) ||
    TERMINAL_CODES.has(type) ||
    TERMINAL_MESSAGE_HINTS.some((h) => hay.includes(h));

  // Named fields, not the raw body: `type` and `code` are what someone greps for six
  // months later, and a wall of JSON in a log line is skipped rather than read.
  //
  // ONLY THE RESPONSE IS LOGGED, NEVER THE REQUEST. Provider inputs are user content —
  // a translated question, a sentence a child was about to hear — and CI invariant 5
  // (`req.body` is never logged) exists for exactly this reason one layer up.
  const summary = `[${label}] status=${status} type=${type || '?'} code=${code || '?'} ` +
    `terminal=${terminal} message=${message ? message.slice(0, 200) : '?'}`;

  return { status, type, code, message, terminal, summary };
}

/**
 * The classification alone, for callers that already hold the parsed fields.
 * Exported so CI can assert the rule without constructing a Response.
 */
export function isTerminalProviderError({ type = '', code = '', message = '' } = {}) {
  const hay = String(message).toLowerCase();
  return TERMINAL_CODES.has(String(code)) ||
    TERMINAL_CODES.has(String(type)) ||
    TERMINAL_MESSAGE_HINTS.some((h) => hay.includes(h));
}
