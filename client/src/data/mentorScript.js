// Feature 27 — client MIRROR of the Voice Mentor's line ids.
//
// The repo is not a monorepo, so this is a hand-kept mirror of
// server/src/config/mentorScript.js — the same arrangement as the taxonomy, and
// guarded the same way (CI invariant 19 fails the build if the two id sets drift).
//
// WHAT IS MIRRORED, AND WHAT IS NOT:
//
// The IDS are mirrored. The TEXT is not, and deliberately so. The client asks the
// server for a line BY ID and gets back a URL to an already-synthesised WAV; it never
// needs to know what the sentence says in order to play it. What the client renders on
// screen comes from translations.js, like every other string in the app.
//
// Keeping the text out of here is not tidiness — it removes an entire class of bug.
// Two copies of a sentence means the copy that is SPOKEN and the copy that is SHOWN can
// disagree, and a child who can read a little would then see one sentence and hear
// another. With one copy of each and an id joining them, that state is unrepresentable.

// Must equal MENTOR_LINE_IDS on the server, exactly. Sorted, so a diff is readable.
export const MENTOR_LINE_IDS = [
  'confirm.checkWithGrownup',
  'confirm.handover',
  'confirm.ok',
  'confirm.retry',
  'course.grade',
  'course.notMatched',
  'course.subject.primary',
  'course.subject.senior',
  'guide.allDone',
  'guide.dayIncomplete',
  'guide.dayIntro',
  'guide.dayNotComplete',
  'guide.dayOverviewDone',
  'guide.generateRoadmap',
  'guide.narrationPrompt',
  'guide.nextVideo',
  'guide.noRoadmap',
  'guide.noVideoToday',
  'guide.pickingQuestions',
  'guide.practice',
  'guide.pressContinue',
  'guide.prevNext',
  'guide.quizFailed',
  'guide.quizPassed',
  'guide.reviewIntro',
  'guide.reviewWeak',
  'guide.roadmapReady',
  'guide.startDiagnostic',
  'guide.takeQuiz',
  'guide.videosDoneTakeQuiz',
  'guide.watchVideo',
  'mentor.farewell',
  'mentor.greeting',
  'mentor.muted',
  'mentor.notUnderstood',
  'mentor.unmuted',
  'mic.denied',
  'mic.prompt',
  'offer.ask',
  'offer.confirmed',
  'offer.declined',
  'offer.language',
  'profile.age',
  'profile.board',
  'profile.city',
  'profile.family',
  'profile.intro',
  'profile.optional',
  'profile.school',
  'study.ask',
  'study.fallback',
  'tour.desktop.days',
  'tour.desktop.mentor',
  'tour.desktop.nav',
  'tour.desktop.progress',
  'tour.desktop.welcome',
  'tour.mobile.days',
  'tour.mobile.mentor',
  'tour.mobile.more',
  'tour.mobile.nav',
  'tour.mobile.progress',
  'tour.mobile.welcome'
];

// ── Which profile fields the microphone may fill ────────────────────────────
//
// AADHAAR IS NEVER VOICE-INPUT, and this list is where that is enforced structurally
// rather than by remembering. `aadhaarNumber` and `aadhaarConsent` are ABSENT, so a mic
// button cannot be rendered for them by a component that iterates this list — the same
// shape as `publicProfile()` enumerating allowed fields rather than deleting disallowed
// ones, and for the same reason: a field added later is invisible until added
// deliberately.
//
// The two reasons, because both are easy to lose:
//
//   1. A MISHEARD DIGIT FAILS VERHOEFF BY CONSTRUCTION. Speech-to-text on a
//      twelve-digit string is not reliable to twelve digits, so the voice path could
//      only ever produce a rejection. It is not a degraded feature; it is a feature
//      that cannot work.
//   2. A NUMBER SPOKEN ALOUD IN A CLASSROOM IS A DISCLOSURE — to the whole room, and
//      it cannot be withdrawn afterwards. `DELETE /api/auth/profile/aadhaar` can
//      remove the number from the database; it cannot remove it from the memory of
//      thirty children.
//
// And consent by voice is not consent. The DPDP record is an unticked box that was
// ticked, with a timestamp. A spoken "haan" recorded as consent would be a consent
// record with no artefact behind it, which is worse than no record at all. THE
// CHECKBOX STAYS A CHECKBOX.
//
// CI invariant 19 asserts both names are absent from this list and that no line id in
// the script reads a number back.
export const VOICE_FILLABLE_FIELDS = [
  'age',
  'studyMedium',
  'fatherName',
  'schoolName',
  'schoolCity'
];

// Fields whose transcribed value is READ BACK for confirmation before it is accepted.
//
// Names are here because a misheard name is stored wrong and silently wrong — nobody
// downstream can tell "Satu" from "Sattu". Age is here for a different reason: it is
// numeric and short, so it FEELS safe, but age is what the whole course level is
// derived from, and a misheard 5-for-9 produces an entire wrong roadmap.
//
// `studyMedium` is absent because it is a closed set: an unmatched answer is already
// visible as a non-match and re-asks, so a read-back would confirm something the
// matcher has already proved.
export const CONFIRM_READBACK_FIELDS = ['age', 'fatherName', 'schoolName', 'schoolCity'];
