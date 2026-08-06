// Feature 27 — the Voice Mentor's SCRIPT. Every sentence the mentor speaks with its
// own voice lives here, keyed by a stable id.
//
// WHY A TABLE OF FIXED STRINGS RATHER THAN GENERATED SPEECH:
//
// Synthesis is the cost centre of this feature, and it is a cost that only has to be
// paid ONCE per sentence. A fixed string hashes to a stable filename, so the first
// child to hear a line pays for it and every child after that replays a WAV off disk
// for nothing. Generated speech has no such property — every utterance is new, so
// every utterance is billed, forever, on a per-child basis.
//
// The rule this encodes: IF THE SAME SENTENCE IS SYNTHESISED TWICE, THAT IS A BUG.
// See PRODUCTION_CHECKLIST "Working practice" for the same principle applied to tests.
//
// WHAT IS NOT IN HERE, AND WHY:
//
// Lines containing a VALUE the child just spoke — "मैंने सुना — सातु। सही है?" — cannot
// be fixed strings, so they can never be cached, so they must never reach a paid
// provider. They live on the CLIENT and are spoken through the browser's own Web
// Speech voice, which is free and on-device. A four-word confirmation is exactly the
// place where Web Speech's variable Hindi quality costs least, and it is the only
// honest answer to a line whose text is unbounded.
//
// The client mirrors the ID LIST (client/src/data/mentorScript.js) so it can request
// lines by id without knowing their text; CI invariant 19 fails the build if the two
// id sets drift. The TEXT lives only here — the client never needs it, because the
// client displays its own translated copy from translations.js and asks the server
// only for audio.

// ── Language codes ──────────────────────────────────────────────────────────
// 'hi' | 'en'. Hindi is the default and the majority case: this feature exists for
// children who cannot yet read the UI, and the UI's Hindi is what they will hear
// around them. Hindi is authored here in the Workstream G SPOKEN register — informal
// तुम, short sentences, no Sanskritised vocabulary — and follows hindiGlossary.js on
// the terms it settles (notably चलाना for playing a video, never खेलना).

export const MENTOR_LANGUAGES = ['hi', 'en'];
export const DEFAULT_MENTOR_LANGUAGE = 'hi';

// ── The script ──────────────────────────────────────────────────────────────
// Shape: { [lineId]: { hi, en } }
//
// Ids are dotted and grouped by the moment they belong to. An id is an API: it is
// requested by the client, it appears in a cached WAV's filename, and renaming one
// orphans its cached audio. Add rather than rename.

export const MENTOR_SCRIPT = {
  // ── The offer, made immediately after signup, before profile onboarding ──
  // Spoken in Hindi ALWAYS, regardless of the site language toggle: at this point
  // nobody has told us what the child speaks, and the default this deployment serves
  // is Hindi. The two answers are large and icon-led; the line names them out loud
  // because a child who cannot read the buttons cannot read a label on them either.
  'offer.ask': {
    hi: 'नमस्ते! क्या तुम चाहते हो कि मैं तुम्हारे साथ रहूँ और बोलकर रास्ता दिखाऊँ? हाँ के लिए हरा गोल बटन दबाओ, और नहीं के लिए बगल वाला बटन।',
    en: 'Hello! Would you like me to stay with you and guide you out loud? Tap the green round button for yes, or the button beside it for no.'
  },
  'offer.language': {
    hi: 'बहुत अच्छा! तुम्हें कौन सी भाषा में सुनना है — हिन्दी या इंग्लिश?',
    en: 'Wonderful! Which language would you like to hear me in — Hindi or English?'
  },
  'offer.confirmed': {
    hi: 'ठीक है! अब मैं तुम्हारे साथ हूँ। जब भी बात करनी हो, मेरी तस्वीर दबा देना।',
    en: "All right! I'm with you now. Whenever you want to talk to me, just tap my picture."
  },
  'offer.declined': {
    hi: 'कोई बात नहीं। अगर बाद में मन करे तो सेटिंग्स में से मुझे चालू कर सकते हो।',
    en: 'That is completely fine. If you change your mind later, you can switch me on from Settings.'
  },

  // ── Profile onboarding, one question at a time ──────────────────────────
  // These MIRROR translations.profileFlow.questions rather than replacing them: the
  // written question stays on screen exactly as it is today and the mentor speaks the
  // same thing. A child who can read a little should not see one sentence and hear
  // another. Reworded slightly for the ear — a spoken question needs to be shorter
  // than a written one, because it cannot be re-read.
  'profile.intro': {
    hi: 'पहले मैं तुम्हारे बारे में कुछ बातें पूछूँगा। एक-एक करके। जवाब बोल सकते हो, या लिख भी सकते हो।',
    en: "First I'll ask you a few things about yourself, one at a time. You can speak your answer, or type it."
  },
  'profile.age': {
    hi: 'तुम्हारी उम्र कितनी है?',
    en: 'How old are you?'
  },
  'profile.board': {
    hi: 'तुम कौन से बोर्ड में पढ़ते हो — सी बी एस ई, या हरियाणा बोर्ड?',
    en: 'Which board do you study under — CBSE, or Haryana Board?'
  },
  'profile.family': {
    hi: 'तुम्हारे पापा का नाम क्या है?',
    en: "What is your father's name?"
  },
  'profile.school': {
    hi: 'तुम्हारे स्कूल का नाम क्या है?',
    en: 'What is the name of your school?'
  },
  'profile.city': {
    hi: 'तुम्हारा शहर या गाँव कौन सा है?',
    en: 'Which city or village do you live in?'
  },

  // ── The optional step. THE AADHAAR LINE IS VERBATIM AND MUST STAY VERBATIM. ──
  //
  // Aadhaar is NEVER voice-input — not the number, not the consent. A misheard digit
  // fails the Verhoeff check by construction, so voice could only ever produce a
  // rejection; and a twelve-digit government identifier spoken aloud in a classroom
  // is a disclosure to everyone in the room. Consent spoken aloud is not consent
  // either: the DPDP record is a ticked box with a timestamp, and it stays one.
  //
  // So the mentor's ONLY role on this step is to say that the step is skippable. It
  // does not read the field, does not offer a microphone, and there is no line id
  // anywhere in this table that reads a number back.
  'profile.optional': {
    hi: 'आधार और जगह अभी भरना ज़रूरी नहीं है — बाद में सेटिंग्स से भी कर सकते हो।',
    en: 'Aadhaar and your area are not required right now — you can add them later from Settings.'
  },

  // ── Confirmation and hand-over ──────────────────────────────────────────
  // The confirm line itself contains the heard value and is spoken client-side (see
  // the header). What IS fixed is everything around it.
  'confirm.retry': {
    hi: 'ठीक है, कोई बात नहीं। एक बार और बोलो — धीरे से।',
    en: "All right, no problem. Say it once more — nice and slowly."
  },
  // After TWO failed attempts, hand over. Never a third loop: a child who was not
  // understood twice will not be understood better the third time, and the loop is
  // the worst possible experience for the person least able to escape it.
  'confirm.handover': {
    hi: 'कोई बात नहीं, मुझे ठीक से सुनाई नहीं दिया। तुम इसे लिख दो, या किसी बड़े से लिखवा लो।',
    en: "That's all right — I couldn't hear it properly. Please type it in, or ask a grown-up to type it for you."
  },
  'confirm.ok': {
    hi: 'बढ़िया! आगे चलते हैं।',
    en: 'Lovely! Let us carry on.'
  },
  // ── When the device has NO Hindi Web Speech voice ───────────────────────
  //
  // The read-back line contains the heard value, so it cannot be cached, so it is
  // spoken by the browser's own voice — and on cheap Android hardware, which is
  // precisely this deployment's target, a hi-IN voice is often simply absent.
  //
  // The failure to avoid is NOT the silence. It is putting a PLAYBACK failure on the
  // TRANSCRIPTION retry budget: a silent prompt spends both attempts producing nothing
  // the child can perceive, and then hands over to typing without the child ever
  // learning why. Those are different failures and the budget belongs to only one.
  //
  // So when no Hindi voice is detected (checked at mount via `voiceschanged`, not
  // discovered on failure), the read-back is SKIPPED rather than performed silently,
  // this cached line plays instead, the value is shown enlarged in its filled field,
  // and THE ATTEMPT COUNTER NEVER STARTS. Nothing was attempted, so nothing is spent.
  //
  // Deliberately NOT the en-IN voice, which is near-universal where hi-IN is not and is
  // the tempting substitution: a Devanagari name through an English voice is noise, and
  // noise is worse than an honest cached sentence. Deliberately NOT the paid TTS path
  // either — it is uncacheable by construction and would fire most often on exactly the
  // hardware where the per-utterance cost compounds.
  'confirm.checkWithGrownup': {
    hi: 'मैंने लिख दिया है। एक बार देख लो — या किसी बड़े से पूछ लो कि सही है या नहीं।',
    en: 'I have written it down. Have a look — or ask a grown-up whether it is right.'
  },
  'mic.prompt': {
    hi: 'बोलने के लिए माइक वाला बटन दबाकर रखो।',
    en: 'Press and hold the microphone button to speak.'
  },
  'mic.denied': {
    hi: 'मुझे माइक की इजाज़त नहीं मिली। कोई बात नहीं — तुम लिखकर जवाब दे सकते हो।',
    en: "I didn't get permission to use the microphone. That's fine — you can type your answer instead."
  },

  // ── Grade and subject ───────────────────────────────────────────────────
  'course.grade': {
    hi: 'तुम कौन सी कक्षा में पढ़ते हो?',
    en: 'Which class are you in?'
  },
  // THE SPOKEN SUBJECT LIST IS BANDED BY GRADE, and the band governs BOTH what is
  // said and what the matcher will accept. The two must be the same list, or the
  // mentor accepts a subject it never offered.
  //
  // Why voice needs this when the visual picker does not: a list of chips on screen is
  // SCANNED and mostly ignored; a list read aloud is a SEQUENCE OF RECOMMENDATIONS, and
  // every item in it carries the authority of a guide the child was told to trust.
  // Reading "NEET" to a seven-year-old is the mentor proposing NEET. The picker never
  // made that claim, so this is a harm the voice path creates rather than one it
  // inherits — which is why the fix lives here and the picker is left alone.
  //
  // Two BANDS rather than a per-grade sentence: an assembled string is a new string per
  // grade, and a new string is a synthesis that has to be paid for. Two fixed lines stay
  // cached forever.
  'course.subject.primary': {
    hi: 'आज कौन सा विषय पढ़ना है? गणित, विज्ञान, अंग्रेज़ी, हिन्दी, या सामाजिक विज्ञान?',
    en: 'Which subject would you like to study? Maths, Science, English, Hindi, or Social Science?'
  },
  'course.subject.senior': {
    hi: 'आज कौन सा विषय पढ़ना है? अपनी पसंद का विषय बोलो।',
    en: 'Which subject would you like to study? Say the subject you want.'
  },
  // A closed set that did not match. ONE re-ask, then the visual picker — the same
  // two-strikes rule as the text fields, for the same reason.
  'course.notMatched': {
    hi: 'मुझे समझ नहीं आया। नीचे दिख रहे बटनों में से चुन लो।',
    en: "I didn't catch that. Please pick from the buttons shown below."
  },

  // ── The dashboard tour, DESKTOP ─────────────────────────────────────────
  // Split from the mobile tour because the sidebar collapses to a bottom bar on a
  // phone (Feature 7). Describing a sidebar to a child looking at a bottom bar is
  // worse than saying nothing: they cannot read the page to correct you, and they
  // will look for a thing that is not there.
  'tour.desktop.welcome': {
    hi: 'यह तुम्हारा अपना पन्ना है। मैं तुम्हें दिखाता हूँ कि यहाँ क्या-क्या है।',
    en: 'This is your very own page. Let me show you what is here.'
  },
  // Desktop names all nine, because they are all on screen at once — describing a
  // visible list is different from describing a hidden one, and the child can be told
  // what each is without having to open anything.
  'tour.desktop.nav': {
    hi: 'बाईं तरफ़ एक लंबी पट्टी है। मैं उसे चमका रहा हूँ, देखो। उसमें ऊपर से नीचे — तुम्हारी पढ़ाई की योजना; अभ्यास, जहाँ जितने चाहो सवाल हल कर सकते हो; पुराने पेपर; तुम्हारी प्रगति; तुम्हारे टेस्ट का नतीजा; पढ़ाई के नोट्स; तुम्हारी अपनी कॉपी; मैं; और सबसे नीचे सेटिंग्स, जहाँ से तुम मेरी आवाज़ बंद कर सकते हो।',
    en: 'There is a tall strip on the left. I am making it glow — have a look. From the top: your study plan; practice, where you can answer as many questions as you like; old exam papers; your progress; your test result; study notes; your own notebook; me; and right at the bottom, settings, where you can switch my voice off.'
  },
  'tour.desktop.progress': {
    hi: 'यहाँ दिखता है कि तुमने कितना पढ़ लिया है। जैसे-जैसे तुम पढ़ोगे, यह पट्टी भरती जाएगी।',
    en: 'This shows how much you have finished. As you study, this bar fills up.'
  },
  'tour.desktop.days': {
    hi: 'और यह रही तुम्हारी पढ़ाई की योजना — एक-एक दिन के हिसाब से। हर दिन का अपना कार्ड है।',
    en: 'And here is your study plan, laid out day by day. Every day has its own card.'
  },
  'tour.desktop.mentor': {
    hi: 'और मैं यहाँ हूँ। जब भी कुछ पूछना हो, मेरी तस्वीर दबा देना — मैं सुन लूँगा।',
    en: 'And I am right here. Whenever you want to ask something, tap my picture and I will listen.'
  },

  // ── The dashboard tour, MOBILE ──────────────────────────────────────────
  'tour.mobile.welcome': {
    hi: 'यह तुम्हारा अपना पन्ना है। मैं तुम्हें दिखाता हूँ कि यहाँ क्या-क्या है।',
    en: 'This is your very own page. Let me show you what is here.'
  },
  'tour.mobile.nav': {
    hi: 'सबसे नीचे जो बटनों की पट्टी है — वहाँ से तुम अलग-अलग जगह जा सकते हो। मैं उसे चमका रहा हूँ, देखो।',
    en: 'That row of buttons right at the bottom is how you move around. I am making it glow — have a look.'
  },
  // ── A5: NAME WHAT IS INSIDE. Never "press it and find out." ──────────────
  //
  // This line used to end "दबा के देख लेना" — press it and see. That is the one thing
  // the mentor must never say. A child who cannot read the screen cannot discover a
  // menu by opening it: they open it, see nine words they cannot read, and are worse
  // off than before because now they are somewhere they did not mean to be.
  //
  // "Instruct and describe" means the mentor says what each item IS and what it DOES,
  // so the child can decide before pressing. The mentor still does not open it.
  'tour.mobile.nav': {
    hi: 'सबसे नीचे बटनों की एक पट्टी है। उसमें तीन चीज़ें हैं — पहली है तुम्हारी पढ़ाई की योजना, दूसरी हूँ मैं, और तीसरी है तुम्हारी अपनी कॉपी जिसमें तुम लिख सकते हो।',
    en: 'There is a row of buttons right at the bottom. It has three things — the first is your study plan, the second is me, and the third is your own notebook where you can write.'
  },
  'tour.mobile.more': {
    hi: 'उसी पट्टी में तीन लकीरों वाला एक और बटन है। उसके अंदर छह चीज़ें हैं — अभ्यास, जहाँ तुम जितने चाहो सवाल हल कर सकते हो; पुराने पेपर; तुम्हारी प्रगति, जो बताती है क्या अच्छा चल रहा है; तुम्हारे टेस्ट का नतीजा; पढ़ाई के नोट्स; और सेटिंग्स, जहाँ से तुम मेरी आवाज़ बंद कर सकते हो।',
    en: 'In that same row there is another button with three lines. Inside it are six things — practice, where you can answer as many questions as you like; old exam papers; your progress, which shows what is going well; your test result; study notes; and settings, where you can switch my voice off.'
  },
  'tour.mobile.progress': {
    hi: 'यहाँ दिखता है कि तुमने कितना पढ़ लिया है। जैसे-जैसे तुम पढ़ोगे, यह पट्टी भरती जाएगी।',
    en: 'This shows how much you have finished. As you study, this bar fills up.'
  },
  'tour.mobile.days': {
    hi: 'और यह रही तुम्हारी पढ़ाई की योजना — एक-एक दिन के हिसाब से। नीचे की तरफ़ खिसकाकर सारे दिन देख सकते हो।',
    en: 'And here is your study plan, day by day. Slide upwards to see all the days.'
  },
  'tour.mobile.mentor': {
    hi: 'और मैं यहाँ हूँ। जब भी कुछ पूछना हो, मेरी तस्वीर दबा देना — मैं सुन लूँगा।',
    en: 'And I am right here. Whenever you want to ask something, tap my picture and I will listen.'
  },

  // ── "What do you want to study today?" ──────────────────────────────────
  'study.ask': {
    hi: 'तो आज क्या पढ़ना है?',
    en: 'So — what would you like to study today?'
  },
  // The no-match path. NOT a re-ask: two big tappable answers instead. A child who
  // was not understood once will not be understood better the second time, and an
  // open question they cannot escape is the worst place to leave them.
  'study.fallback': {
    hi: 'चलो, मैं तुम्हें तुम्हारी पढ़ाई की योजना पर ले चलूँ? नीचे दोनों बटनों में से एक दबा दो।',
    en: 'Shall I take you to your study plan? Tap one of the two buttons below.'
  },

  // ── Guidance to the current day. INSTRUCTS, NEVER NAVIGATES. ────────────
  //
  // The mentor says "tap the card" and lights it up. It does not tap it. A wrong
  // auto-navigation strands a child who cannot read the page they landed on and
  // cannot describe where they are — the one failure this feature must not have,
  // because the child has no way to report it and no way to get back.
  //
  // Which day, and what the day still needs, are derived from the ROADMAP (see
  // routes/mentorVoice.js GET /context). Never from a stored copy: a second record of
  // "where the child was" is a state that can disagree with the roadmap, and when it
  // disagrees the mentor confidently sends a child to a day they already finished.
  'guide.dayIntro': {
    hi: 'मैं तुम्हारे आज के दिन का कार्ड चमका रहा हूँ। उसे दबाओ।',
    en: 'I am lighting up today\'s card for you. Tap it.'
  },
  'guide.watchVideo': {
    hi: 'पहले वीडियो चलाओ और पूरा देखो। फिर उसके बाद सवाल हल करने हैं।',
    en: 'First play the video and watch it all the way through. The questions come after that.'
  },
  'guide.takeQuiz': {
    hi: 'वीडियो हो गया! अब नीचे वाले सवाल हल करो — तभी यह दिन पूरा माना जाएगा।',
    en: 'The video is done! Now answer the questions below — the day is only finished after that.'
  },
  'guide.dayIncomplete': {
    hi: 'यह दिन अभी पूरा नहीं हुआ है। वीडियो देखना और सवाल हल करना, दोनों बाक़ी हैं।',
    en: 'This day is not finished yet. Both the video and the questions are still left.'
  },
  'guide.allDone': {
    hi: 'वाह! तुमने पूरी योजना ख़त्म कर ली है। अब चाहो तो अभ्यास कर सकते हो।',
    en: 'Wonderful! You have finished the whole plan. You can practise now if you like.'
  },
  // No roadmap yet → the diagnostic, which is where a roadmap comes from.
  'guide.noRoadmap': {
    hi: 'अभी तुम्हारी कोई योजना नहीं बनी है। पहले एक छोटा सा टेस्ट देना होगा — उसी से तुम्हारी योजना बनेगी।',
    en: 'You do not have a plan yet. First there is a short test — that is what your plan is built from.'
  },
  'guide.practice': {
    hi: 'अभ्यास वाले हिस्से में जाओ — वहाँ जितने चाहो उतने सवाल हल कर सकते हो।',
    en: 'Go to the practice section — you can answer as many questions as you like there.'
  },

  // ── B: GUIDANCE ON EVERY SCREEN ─────────────────────────────────────────
  //
  // THE RULE, everywhere below: **if a child must press something, the mentor says
  // WHICH thing and highlights it.** A silent screen is a stranded child. They cannot
  // read the button, cannot read the heading that would tell them what the screen is
  // for, and — unlike an adult — cannot guess from layout conventions they have never
  // been taught.
  //
  // The commonest failure this closes is subtler than a missing instruction: a child
  // answers a question and believes they are finished, because ANSWERING and SUBMITTING
  // look identical when you cannot read the button. They then wait. Nothing happens.

  // The course picker → the diagnostic.
  'guide.startDiagnostic': {
    hi: 'अब नीचे वाला बड़ा हरा बटन दबाओ। उससे तुम्हारा छोटा सा टेस्ट शुरू होगा।',
    en: 'Now press the big green button below. That starts your short test.'
  },
  // The one-time narration prompt (Feature 21). If the child accepted guidance, this
  // screen speaks too — otherwise the first thing the mentor does is fall silent in
  // front of a modal the child cannot read.
  'guide.narrationPrompt': {
    hi: 'यहाँ पूछा जा रहा है कि सवाल अपने-आप बोलकर सुनाए जाएँ या नहीं। हाँ वाला बटन दबाओगे तो हर सवाल तुम्हें पढ़कर सुनाया जाएगा। ना वाला बटन दबाओगे तो चुपचाप दिखेगा। तुम्हारे लिए हाँ ठीक रहेगा।',
    en: 'This is asking whether the questions should be read out to you. If you press yes, every question will be read aloud. If you press no, they will just appear silently. Yes is better for you.'
  },
  // Answering is not submitting. This is the single most important line in B.
  'guide.pressContinue': {
    hi: 'शाबाश! जवाब चुन लिया। अब आगे बढ़ने के लिए नीचे वाला बटन दबाना ज़रूरी है — तभी अगला सवाल आएगा।',
    en: 'Well done — you have chosen your answer. Now you must press the button below to go on. The next question only comes after that.'
  },
  'guide.prevNext': {
    hi: 'नीचे दो बटन हैं। दाईं तरफ़ वाला अगले सवाल पर ले जाता है, और बाईं तरफ़ वाला पिछले सवाल पर वापस।',
    en: 'There are two buttons below. The one on the right takes you to the next question, and the one on the left goes back to the question before.'
  },
  // The variable-length diagnostic. A child who expects twenty questions and gets ten
  // thinks something broke.
  'guide.pickingQuestions': {
    hi: 'रुको ज़रा — मैं तुम्हारे लिए अगले सवाल चुन रहा हूँ। और एक बात: सवालों की गिनती पक्की नहीं है। अगर तुम अच्छा कर रहे हो तो टेस्ट जल्दी ख़त्म हो जाएगा। जल्दी ख़त्म होना अच्छी बात है, कोई गड़बड़ नहीं।',
    en: 'Wait just a moment — I am choosing your next questions. And one more thing: the number of questions is not fixed. If you are doing well, the test will finish early. Finishing early is a good thing, not a mistake.'
  },

  // ── The diagnostic review ───────────────────────────────────────────────
  // The score itself contains numbers, so it cannot be a cached line — it is read out
  // client-side with the browser voice, like the confirm read-back. These are the fixed
  // sentences around it.
  'guide.reviewIntro': {
    hi: 'तुम्हारा टेस्ट हो गया! अब मैं तुम्हें बताता हूँ कि कैसा रहा।',
    en: 'Your test is done! Let me tell you how it went.'
  },
  'guide.reviewWeak': {
    hi: 'नीचे लाल रंग में वे चीज़ें दिख रही हैं जिन पर तुम्हें थोड़ी और मेहनत करनी है। घबराना नहीं — इन्हीं के हिसाब से तुम्हारी पढ़ाई की योजना बनेगी।',
    en: 'The things shown in red below are the ones you need a little more practice on. Do not worry — your study plan will be built around exactly these.'
  },
  'guide.generateRoadmap': {
    hi: 'अब नीचे वाला बटन दबाओ। उससे तुम्हारे लिए दिन-ब-दिन की पढ़ाई की योजना बन जाएगी।',
    en: 'Now press the button below. It will build your day-by-day study plan.'
  },
  'guide.roadmapReady': {
    hi: 'तुम्हारी योजना तैयार है! हर दिन का अपना कार्ड है। पहले दिन वाला कार्ड दबाकर शुरू करो।',
    en: 'Your plan is ready! Every day has its own card. Press the first day\'s card to begin.'
  },

  // ── The day page ────────────────────────────────────────────────────────
  'guide.dayOverviewDone': {
    hi: 'यह था आज के दिन का पाठ। अब नीचे जाओ — वहाँ वीडियो हैं। किसी एक वीडियो पर दबाओ और उसे पूरा देखो।',
    en: 'That was today\'s lesson. Now go down — there are videos there. Press one of the videos and watch it all the way through.'
  },
  'guide.nextVideo': {
    hi: 'यह वीडियो पूरा हो गया, शाबाश! उसके नीचे एक और वीडियो है — उसे भी देख लो।',
    en: 'That video is finished, well done! There is another video below it — watch that one too.'
  },
  'guide.videosDoneTakeQuiz': {
    hi: 'सारे वीडियो देख लिए! अब नीचे वाले सवाल हल करो। ये हो गए तो आज का दिन पूरा।',
    en: 'You have watched all the videos! Now answer the questions below. Once those are done, today is complete.'
  },
  // A day with no usable video. See PRODUCTION_CHECKLIST — the Feature 9 gate needs a
  // video watched AND the quiz passed, so a video-less day cannot be completed at all.
  // The mentor must not tell a child to press something that is not there.
  'guide.noVideoToday': {
    hi: 'आज इस पाठ के लिए कोई वीडियो नहीं मिला। कोई बात नहीं — ऊपर वाला पाठ पढ़ लो, और फिर नीचे वाले सवाल हल करो।',
    en: 'There is no video for this lesson today. That is all right — read the lesson above, then answer the questions below.'
  },

  // The page already PRINTS this when Mark-as-Complete is refused. A child who cannot
  // read it is silently blocked by a rule nobody told them about.
  'guide.dayNotComplete': {
    hi: 'यह दिन अभी पूरा नहीं हुआ। पहले कोई एक वीडियो पूरा देखो, और फिर नीचे वाले सवाल हल करके पास करो। तब यह दिन अपने आप पूरा हो जाएगा।',
    en: 'This day is not finished yet. First watch one of the videos all the way through, then answer the questions below and pass them. The day completes on its own after that.'
  },

  // ── After a module quiz is submitted ────────────────────────────────────
  // The SCORE is variable, so it is spoken client-side through speakLocal, exactly like
  // the diagnostic review. These fixed lines carry the MEANING, so a device with no
  // local voice still learns what happened and what to do — only the number goes unsaid.
  'guide.quizPassed': {
    hi: 'शाबाश! तुमने क्विज़ पास कर लिया और यह दिन पूरा हो गया। अब अगले दिन पर जाओ — मैं उसका बटन चमका रहा हूँ।',
    en: 'Well done! You passed the quiz and this day is complete. Now go to the next day — I am lighting up its button.'
  },
  'guide.quizFailed': {
    hi: 'इस बार पास नहीं हुआ, कोई बात नहीं। ऊपर वाला पाठ और वीडियो एक बार फिर देख लो, फिर क्विज़ दोबारा करो। और जो हिस्सा मुश्किल लगा हो, वह मेंटर से पूछ सकते हो — वह समझा देगा।',
    en: 'Not a pass this time, and that is all right. Look at the lesson and the videos once more, then take the quiz again. And whatever felt hard, you can ask Mentor — it will explain it to you.'
  },

  // ── Presence, mute, and switching off ───────────────────────────────────
  'mentor.greeting': {
    hi: 'हाँ बोलो, मैं सुन रहा हूँ।',
    en: 'Yes, I am listening.'
  },
  'mentor.notUnderstood': {
    hi: 'मुझे समझ नहीं आया। एक बार और बोलोगे?',
    en: "I didn't understand that. Would you say it once more?"
  },
  'mentor.muted': {
    hi: 'ठीक है, मैं चुप हो जाता हूँ।',
    en: 'All right, I will be quiet.'
  },
  'mentor.unmuted': {
    hi: 'मैं वापस आ गया।',
    en: 'I am back.'
  },
  // Spoken when a child turns out to be above the configured grade threshold. They
  // are NOT dropped mid-flow — the mentor finishes onboarding with them and says
  // goodbye at the end, because vanishing mid-question strands them exactly as badly
  // as a wrong navigation does.
  'mentor.farewell': {
    hi: 'तुम्हारी कक्षा के लिए यह ऐप बिना आवाज़ के ही ठीक है। अब मैं यहीं रुकता हूँ — पढ़ाई शुरू करो!',
    en: 'For your class the app works well without me. I will stop here — go ahead and start studying!'
  }
};

// ── Derived helpers ─────────────────────────────────────────────────────────

/** Every line id, sorted. Used by the warm-cache script and by the CI drift check. */
export const MENTOR_LINE_IDS = Object.keys(MENTOR_SCRIPT).sort();

/**
 * The text for a line, or null if the id is unknown.
 *
 * Returning null rather than throwing is deliberate: an unknown id reaching here means
 * a stale client asked for a line that has since been removed, and the right answer to
 * that is silence plus a 404, not a 500 on a route a child is waiting on.
 */
export function mentorLine(lineId, lang = DEFAULT_MENTOR_LANGUAGE) {
  const entry = MENTOR_SCRIPT[lineId];
  if (!entry) return null;
  const code = MENTOR_LANGUAGES.includes(lang) ? lang : DEFAULT_MENTOR_LANGUAGE;
  return entry[code] || entry[DEFAULT_MENTOR_LANGUAGE] || null;
}
