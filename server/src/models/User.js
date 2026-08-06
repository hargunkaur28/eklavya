import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // Phase 2: a document's inherent role. Every real signup is a student; the
  // 'parent' role is a SESSION role resolved at login (Option B, Phase 3) and is
  // not stored here. Default keeps all pre-Phase-2 users as students.
  role: { type: String, enum: ['student', 'parent', 'admin'], default: 'student' },
  // Phase 3 (Option B): the parent logs in with the SAME email as the student.
  // A bcrypt hash of the parent's password lives on the student's own document;
  // its PRESENCE is the "this student has a linked parent" signal (no parentOf).
  // Plaintext is NEVER stored — shown once at creation, then only the hash remains.
  parentPasswordHash: { type: String, default: null },
  // Forces the PARENT to set their own password on first login. Named for the
  // parent specifically so it can never gate the student's own password.
  parentMustChangePassword: { type: Boolean, default: false },
  // Phase 7.5: Cloudinary secure_url of the student's profile photo (null = show
  // the generic icon). Only the URL is stored — never raw image bytes. The asset
  // uses a deterministic public_id keyed to this user so re-upload overwrites in
  // place (no orphaned images accumulate).
  photoUrl: { type: String, default: null },
  // Phase 8: account-wide study streak. Each entry is a 'YYYY-MM-DD' in the
  // student's LOCAL date (sent by the client) — a day counts as "active" when the
  // student watches a video to threshold, submits a module quiz, or does a
  // practice session. Streaks are computed client-side from these local dates.
  studyDates: { type: [String], default: [] },
  // Narration/voice preferences (account-level so they survive across devices/logins,
  // same additive-default pattern as `role`/`photoUrl` — existing users get the
  // defaults with zero migration).
  // How quiz/lesson narration picks its language. 'hindi' (site-wide default per
  // spec) narrates Hindi for all NON-English subjects regardless of what's on screen;
  // 'english' always narrates English; 'match-toggle' follows the site language toggle
  // (the pre-feature behavior, kept as an explicit opt-in).
  narrationLanguagePref: { type: String, enum: ['hindi', 'english', 'match-toggle'], default: 'hindi' },
  // Whether questions auto-narrate on load. Default false — never auto-play audio
  // before the student has opted in (the first-run popup invites them to enable it).
  autoNarrateQuizzes: { type: Boolean, default: false },
  // Whether the one-time narration popup has been shown. Once true (whether the
  // student chose Yes or No), the popup never appears again across any quiz surface.
  // They can still change prefs from Settings at any time.
  hasSeenNarrationPrompt: { type: Boolean, default: false },
  // Account-side copy of the site language toggle (Feature 3 kept it in localStorage
  // only). localStorage stays the fast/offline cache; this is the source of truth on
  // login, so setting Hindi on one device shows Hindi on the next.
  siteLanguage: { type: String, enum: ['en', 'hi'], default: 'en' },

  // ── Feature 27: Voice Mentor ────────────────────────────────────────────
  //
  // THESE FOUR FIELDS ARE THE ONLY NEW PERSISTED STATE IN THE WHOLE FEATURE, and that
  // is a deliberate constraint rather than a happy accident.
  //
  // The mentor knows what the child has been doing — which roadmap, which day, whether
  // the videos are watched and the quiz passed, what practice they have done. NONE of
  // that is stored here. It is assembled per request from the models that already own
  // it (utils/mentorContext.js reads Roadmap, PracticeSession, Note and studyDates).
  //
  // The reason is that a second record of "where the child was" is a state that CAN
  // DISAGREE with the roadmap, and the roadmap is authoritative about its own progress.
  // When the two disagree the mentor does not fail visibly — it speaks with complete
  // confidence, telling a child to open a day they finished last week or to take a quiz
  // they already passed. A child who cannot read the screen has no way to notice the
  // mentor is wrong and no way to say so. So there is nothing to disagree with: the
  // only things kept here are the ones with no existing home.
  mentorVoice: {
    // Whether the post-signup offer has been MADE. Distinct from `enabled: false`,
    // which means the offer was made and declined — the same distinction Design Rule 3
    // draws between "deliberately not sampled" and "sampled and failed". Collapsing
    // them re-offers the mentor forever to a child who already said no.
    offered: { type: Boolean, default: false },
    enabled: { type: Boolean, default: false },
    // SEPARATE from `narrationLanguagePref`, not a duplicate of it. That field carries
    // an English-subject exemption: set to 'hindi' it still narrates English-subject
    // content in English, which is right for a Class 10 student reading a passage and
    // wrong for a five-year-old who can read neither language. A mentor set to Hindi
    // speaks Hindi always. Different semantics, different field.
    //
    // On the child's FIRST choice the mentor language also writes through to
    // `narrationLanguagePref` — but only when `hasSeenNarrationPrompt` is still false,
    // so an existing explicit preference is never overwritten and the child is not
    // asked the same question twice in two different flows.
    language: { type: String, enum: ['hi', 'en'], default: 'hi' },
    // Fires once on first arrival at the dashboard, like `hasSeenNarrationPrompt`. One
    // flag rather than one per form factor: the tour is replayable from an
    // always-visible control on the mentor avatar, so a child who first arrives on a
    // phone and later opens a laptop is one tap from the desktop version.
    tourSeen: { type: Boolean, default: false }
  },

  // ── Workstream B: student profile onboarding ─────────────────────────────
  // Additive, same pattern as `role`/`photoUrl`: every field has a safe default,
  // so an account created before this change loads and logs in unchanged. Existing
  // students are marked onboardingCompleted:true by the one-time backfill
  // (scripts/backfill-onboarding.js) so they are never sent through the flow.
  onboardingCompleted: { type: Boolean, default: false },
  onboardingCompletedAt: { type: Date, default: null },

  profile: {
    // Compulsory — the flow cannot be completed without these.
    age: { type: Number, default: null },
    studyMedium: { type: String, default: '' },       // board; closed set — config/taxonomy.js BOARDS

    // ── Workstream H: board reduction, existing accounts ────────────────────
    // The board list dropped from nine entries (plus an 'Other' free-text escape)
    // to the two the platform actually serves. Accounts holding a removed value are
    // migrated by scripts/backfill-board.js, which EMPTIES studyMedium and parks the
    // old value here rather than deleting it or guessing a replacement.
    //
    // Why preserve it: it is the student's own answer, it is the only thing
    // `--rollback` can restore from, and "how many of our students said ICSE" is a
    // real product question that a destructive migration would have thrown away.
    // Nothing reads it for behaviour — it is never offered, never validated against,
    // and never used to select a PYQ corpus. It is a record, not a fallback.
    legacyStudyMedium: { type: String, default: '' },

    // Set by the same backfill. The student is asked to re-pick ONCE on next login;
    // the prompt clears this flag whether they choose or dismiss, so it can never
    // become a modal they cannot get past. Deliberately NOT done by resetting
    // `onboardingCompleted`, which would drag them through all five steps again to
    // re-answer one question.
    boardNeedsReselect: { type: Boolean, default: false },
    fatherName: { type: String, default: '' },
    schoolName: { type: String, default: '' },
    schoolCity: { type: String, default: '' },        // city OR village

    // Optional — every one of these is skippable and must never block progress.
    phoneNumber: { type: String, default: '' },       // 10 digits, +91/spaces stripped
    location: {
      village: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' }
      // Deliberately NO latitude/longitude. Reverse geocoding happens server-side
      // and the coordinates are discarded after the lookup — there is no field here
      // for them to be written to, by accident or otherwise.
    },

    // Aadhaar. The PLAINTEXT NUMBER IS NEVER STORED — not here, not in a temporary
    // field. `aadhaarEncrypted` holds an AES-256-GCM envelope produced by
    // utils/aadhaarCrypto.js, and `aadhaarLast4` is the only plaintext digit data
    // kept, solely so a masked "XXXX XXXX 1234" can be displayed. There is no
    // decrypt path in the codebase, so nothing can read the number back.
    aadhaarEncrypted: {
      ciphertext: { type: String, default: '' },
      iv: { type: String, default: '' },
      authTag: { type: String, default: '' }
    },
    aadhaarLast4: { type: String, default: '' },
    // DPDP Act, 2023: consent must be explicit and recorded. Aadhaar is not accepted
    // without a ticked box, and the timestamp of that consent is stored.
    aadhaarConsentAt: { type: Date, default: null }
  },

  createdAt: { type: Date, default: Date.now }
});

// ── Keeping the encrypted envelope out of every read path ──────────────────
//
// Two layers, because each one alone has a hole.
//
// Layer 1 — document transforms. Strips the envelope from any serialisation, so a
// route that forgets `.select()` and returns a raw document still cannot leak it.
// HOLE: Mongoose skips document transforms entirely on `.lean()` and on aggregation
// pipelines — and `.lean()` is exactly what gets reached for on list endpoints.
function stripAadhaarEnvelope(doc, ret) {
  if (ret?.profile?.aadhaarEncrypted) delete ret.profile.aadhaarEncrypted;
  return ret;
}
userSchema.set('toJSON', { transform: stripAadhaarEnvelope });
userSchema.set('toObject', { transform: stripAadhaarEnvelope });

// Layer 2 — QUERY middleware, which closes that hole because it changes the query
// rather than the returned document, so it applies to `.lean()` too. Every find
// projects the envelope away unless a caller explicitly opts in.
function excludeAadhaarEnvelope(next) {
  // Deliberate, auditable opt-in for the one future case that may need the
  // ciphertext (an offline, admin-gated export — see PRODUCTION_CHECKLIST).
  if (this.getOptions && this.getOptions().includeAadhaarEnvelope === true) return next();

  // An INCLUSIVE projection (`.select('name email')`) already excludes the envelope
  // by omission, and MongoDB rejects mixing inclusion with exclusion — so leave it
  // alone rather than producing an invalid projection.
  const projection = (this.projection && this.projection()) || {};
  const explicit = Object.keys(projection).filter((k) => k !== '_id');
  const isInclusive = explicit.some((k) => projection[k] === 1 || projection[k] === true);
  if (isInclusive) return next();

  this.select('-profile.aadhaarEncrypted');
  next();
}

// Covers find, findOne, findById, findOneAndUpdate, findOneAndDelete, count, etc.
userSchema.pre(/^find/, excludeAadhaarEnvelope);

// Aggregation bypasses both layers by design, so it gets its own guard: any pipeline
// on this collection has the envelope projected out at the first stage.
userSchema.pre('aggregate', function stripInAggregate(next) {
  this.pipeline().unshift({ $unset: 'profile.aadhaarEncrypted' });
  next();
});

export default mongoose.model('User', userSchema);
