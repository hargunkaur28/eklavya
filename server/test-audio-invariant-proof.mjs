// Prove invariants 18 and 19 can FAIL.
//
// A structural check is worth exactly what its failure mode is worth. Invariant 18 is
// the child-audio guarantee; if it can pass while a write path exists, every part of
// Feature 27 built on top of it rests on a check that proves nothing. That is Design
// Rule 11, and it is cheap now and expensive to discover later.
//
// Each scenario plants ONE violation in a real source file, runs the real invariant
// suite, and asserts that the suite exits non-zero AND names the expected reason. The
// original file bytes are restored in a `finally`, so a crash mid-run cannot leave a
// planted violation behind.
//
// The two NEGATIVE scenarios at the end are the important ones: they plant something
// that LOOKS like a violation and assert the suite still passes. A check that fires on
// legitimate code gets deleted by the next person who hits it.

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Paths are derived from this file's own location so the suite runs from any cwd and
// on any checkout — an absolute path here would make it a one-machine test.
const SERVER = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
const CLIENT = SERVER.replace(/\/server$/, '/client');
const F = {
  chat: `${SERVER}/src/routes/chat.js`,
  user: `${SERVER}/src/models/User.js`,
  speech: `${CLIENT}/src/hooks/useSpeechInput.js`,
  cliScript: `${CLIENT}/src/data/mentorScript.js`,
  srvScript: `${SERVER}/src/config/mentorScript.js`
};

const STT_ANCHOR = "const result = await sarvamSpeechToText(req.file.buffer, req.file.originalname || 'audio.webm');";

const SCENARIOS = [
  // ── 18a: multer configured to spill to disk ──
  {
    name: '18a  multer diskStorage in the STT route',
    file: F.chat,
    find: 'storage: multer.memoryStorage(),',
    replace: 'storage: multer.diskStorage({ destination: "uploads/" }),',
    expect: 'multer diskStorage'
  },
  {
    name: '18a  multer dest: in the STT route',
    file: F.chat,
    find: 'storage: multer.memoryStorage(),',
    replace: "dest: 'uploads/voice/',",
    expect: 'multer dest:'
  },

  // ── 18b: the upload buffer reaches a persistence call ──
  {
    name: '18b  saveAudioFile(req.file.buffer) — the direct form',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `saveAudioFile('clip.wav', req.file.buffer);\n    ${STT_ANCHOR}`,
    expect: 'saveAudioFile(...) receives an uploaded audio buffer'
  },
  {
    name: '18b  aliased: const clip = req.file.buffer, then writeFileSync(clip)',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `const clip = req.file.buffer;\n    writeFileSync('/tmp/clip.wav', clip);\n    ${STT_ANCHOR}`,
    expect: 'writeFileSync(...) receives an uploaded audio buffer'
  },
  {
    // The shape that defeated the argument-only check: the buffer goes to a method on
    // the handle, not to the call that made it. Now caught by the PRESENCE rule, which
    // is the stronger answer — a file handle in a microphone handler is wrong before
    // anyone asks what gets written to it.
    name: '18b  destructured: const { buffer } = req.file, then createWriteStream().end()',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `const { buffer } = req.file;\n    createWriteStream('/tmp/c.wav').end(buffer);\n    ${STT_ANCHOR}`,
    expect: 'createWriteStream inside a microphone-upload handler'
  },
  {
    // Isolates the METHOD-sink path: no file handle anywhere, so the presence rule
    // cannot be what catches it. Without this the method sinks would be untested — the
    // stream scenario above passes on the presence rule alone.
    name: '18b  the clip written into a collection (method sink, no file handle)',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `const { buffer } = req.file;\n    await Recordings.insertOne({ clip: buffer });\n    ${STT_ANCHOR}`,
    expect: '.insertOne(...) receives an uploaded audio buffer'
  },
  {
    name: '18b  the clip stashed in a temp file',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `const tmp = tmpdir();\n    ${STT_ANCHOR}`,
    expect: 'NOT TO A TEMP FILE'
  },
  {
    name: '18b  nested: writeFileSync(p, Buffer.from(req.file.buffer)) — defeats a naive regex',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `writeFileSync('/tmp/c.wav', Buffer.from(req.file.buffer));\n    ${STT_ANCHOR}`,
    expect: 'writeFileSync(...) receives an uploaded audio buffer'
  },
  {
    name: '18b  the clip sent to Cloudinary',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `uploadBufferToCloudinary(req.file.buffer);\n    ${STT_ANCHOR}`,
    expect: 'uploadBufferToCloudinary(...) receives an uploaded audio buffer'
  },
  {
    name: '18b  VACUITY: the multer field renamed out from under the check',
    file: F.chat,
    find: "upload.single('audio')",
    replace: "upload.single('clip')",
    expect: 'NO audio-upload route was found to check'
  },

  // ── 18c: a place for recorded audio to land ──
  {
    name: '18c  a model field named for recorded audio',
    file: F.user,
    find: '  createdAt: { type: Date, default: Date.now }',
    replace: '  voiceRecording: { type: String, default: null },\n  createdAt: { type: Date, default: Date.now }',
    expect: 'a model field names recorded audio'
  },
  {
    name: '18c  a model field of type Buffer',
    file: F.user,
    find: '  createdAt: { type: Date, default: Date.now }',
    replace: '  lastClip: { type: Buffer, default: null },\n  createdAt: { type: Date, default: Date.now }',
    expect: 'a model declares a Buffer field'
  },

  // ── 18d: the client half ──
  {
    name: '18d  the recording cached in localStorage',
    file: F.speech,
    find: 'const audioBlob = new Blob(audioChunksRef.current',
    replace: "localStorage.setItem('lastClip', 'x');\n        const audioBlob = new Blob(audioChunksRef.current",
    expect: 'localStorage.setItem in a recording file'
  },
  {
    name: '18d  the recording written to IndexedDB',
    file: F.speech,
    find: 'const audioBlob = new Blob(audioChunksRef.current',
    replace: 'indexedDB.open("clips");\n        const audioBlob = new Blob(audioChunksRef.current',
    expect: 'indexedDB in a recording file'
  },
  {
    name: '18d  a blob URL made from the recording',
    file: F.speech,
    find: 'const audioBlob = new Blob(audioChunksRef.current',
    replace: 'URL.createObjectURL(new Blob([]));\n        const audioBlob = new Blob(audioChunksRef.current',
    expect: 'createObjectURL in a recording file'
  },
  {
    name: '18d  the recording posted somewhere other than transcription',
    file: F.speech,
    find: '`${api}/chat/stt`',
    replace: '`${api}/chat/archive-recording`',
    expect: 'recorded audio goes to transcription and nowhere else'
  },

  // ── 19: drift, and Aadhaar by voice ──
  {
    name: '19   a line id dropped from the client mirror',
    file: F.cliScript,
    find: "  'guide.watchVideo',\n",
    replace: '',
    expect: 'the client mirrors every server line id'
  },
  {
    name: '19   a line id the server cannot speak',
    file: F.cliScript,
    find: "  'guide.watchVideo',",
    replace: "  'guide.watchVideo',\n  'guide.inventedByTheClient',",
    expect: 'the client declares no line the server cannot speak'
  },
  {
    name: '19   aadhaarNumber made voice-fillable',
    file: F.cliScript,
    find: "  'schoolCity'\n];",
    replace: "  'schoolCity',\n  'aadhaarNumber'\n];",
    expect: 'aadhaarNumber is NOT voice-fillable'
  },
  {
    name: '19   aadhaarConsent made voice-fillable',
    file: F.cliScript,
    find: "  'schoolCity'\n];",
    replace: "  'schoolCity',\n  'aadhaarConsent'\n];",
    expect: 'aadhaarConsent is NOT voice-fillable'
  },
  {
    name: '19   the verbatim Aadhaar opt-out wording reworded',
    file: F.srvScript,
    find: 'आधार और जगह अभी भरना ज़रूरी नहीं है',
    replace: 'आधार भरना ज़रूरी नहीं है',
    expect: 'the Aadhaar opt-out wording is verbatim'
  },
  {
    name: '19   a second line that talks about Aadhaar',
    file: F.srvScript,
    find: "  'study.ask': {",
    replace: "  'study.aadhaar': {\n    hi: 'अपना आधार नंबर बोलो।',\n    en: 'Say your Aadhaar number.'\n  },\n  'study.ask': {",
    expect: 'exactly one line mentions Aadhaar'
  },
  {
    name: '19   a templated line (uncacheable by construction)',
    file: F.srvScript,
    find: "  'study.ask': {",
    replace: "  'study.greet': {\n    hi: 'नमस्ते ${name}!',\n    en: 'Hello ${name}!'\n  },\n  'study.ask': {",
    expect: 'no line is a template'
  },

  // ── NEGATIVE CONTROLS — these must NOT fire ──
  {
    name: 'NEG  cached TTS written inside the STT route span still passes',
    file: F.chat,
    find: STT_ANCHOR,
    replace: `const ttsBuf = await synthesizeSpeech('hello', 'hi-IN');\n    saveAudioFile('mentor-x.wav', ttsBuf);\n    ${STT_ANCHOR}`,
    mustPass: true
  },
  {
    name: 'NEG  a note IMAGE upload reaching Cloudinary still passes',
    file: F.chat,
    find: "const upload = multer({",
    replace: "const imageUpload = multer({ storage: multer.memoryStorage() });\nrouter.post('/img', imageUpload.single('image'), async (req, res) => { await uploadNoteImage(req.file.buffer); });\nconst upload = multer({",
    mustPass: true
  }
];

let planted = 0;
let caught = 0;
const misses = [];

for (const s of SCENARIOS) {
  const original = readFileSync(s.file, 'utf8');
  if (!original.includes(s.find)) {
    misses.push(`${s.name}  — SCENARIO ANCHOR NOT FOUND (the fixture is wrong, not the code)`);
    continue;
  }
  planted++;
  try {
    writeFileSync(s.file, original.replace(s.find, s.replace), 'utf8');

    let out = '';
    let exit = 0;
    try {
      out = execSync('node ci-invariants.mjs', { cwd: SERVER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      exit = e.status ?? 1;
      out = `${e.stdout || ''}${e.stderr || ''}`;
    }

    if (s.mustPass) {
      if (exit === 0) { caught++; console.log(`OK (still passes)  ${s.name}`); }
      else { misses.push(`${s.name}  — FIRED ON LEGITIMATE CODE (false positive)`); console.log(`*** FALSE POSITIVE ***  ${s.name}`); }
    } else if (exit !== 0 && out.includes(s.expect)) {
      caught++;
      console.log(`CAUGHT             ${s.name}`);
    } else if (exit !== 0) {
      misses.push(`${s.name}  — failed, but not for the stated reason (expected "${s.expect}")`);
      console.log(`*** WRONG REASON ***  ${s.name}`);
    } else {
      misses.push(`${s.name}  — NOT CAUGHT. The check passed with the violation present.`);
      console.log(`*** NOT CAUGHT ***  ${s.name}`);
    }
  } finally {
    writeFileSync(s.file, original, 'utf8');   // always, even on a throw
  }
}

console.log('');
console.log(`${caught}/${planted} scenarios behaved correctly.`);
if (misses.length) {
  console.log('');
  misses.forEach((m) => console.log(`  ${m}`));
  process.exit(1);
}
console.log('Invariants 18 and 19 fail when they should and pass when they should.');
