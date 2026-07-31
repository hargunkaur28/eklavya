// The figure that started this: a cell nucleus rendered as four labels stacked inside
// an empty oval. Valid SVG, correct viewBox, under the cap, sanitised clean, alt text
// present — and it taught nothing.
import dotenv from 'dotenv';
import { generateDiagramFor, validateDepiction, DIAGRAM_MODEL, CACHED_SVG_MAX_BYTES } from './src/utils/generateDiagram.js';
dotenv.config();

// Reconstructed from the reported render: one outline, four labels, no leaders.
const BEFORE = '<svg viewBox="0 0 400 300">'
  + '<ellipse cx="200" cy="150" rx="90" ry="110" stroke="currentColor" fill="none"/>'
  + '<text x="170" y="90" font-size="14">Nucleus</text>'
  + '<text x="160" y="140" font-size="14">Nucleolus</text>'
  + '<text x="140" y="165" font-size="14">Nuclear Envelope</text>'
  + '<text x="155" y="190" font-size="14">Chromatin</text>'
  + '</svg>';

const QUESTION = {
  questionText: 'Which part of the nucleus contains the genetic material, and what separates the nucleus from the cytoplasm?',
  options: ['Nucleolus; cell wall', 'Chromatin; nuclear envelope', 'Cytoplasm; plasma membrane', 'Ribosome; vacuole']
};

console.log(`── BEFORE (what shipped) ─────────────────────────`);
const b = validateDepiction(BEFORE);
console.log(BEFORE);
console.log(`bytes=${Buffer.byteLength(BEFORE, 'utf8')} shapes=${b.stats.drawings} labels=${b.stats.texts} leaders=${b.stats.leaders}`);
console.log(`validator: ${b.ok ? 'ACCEPTED' : `REJECTED [${b.reason}] — ${b.detail}`}`);

console.log(`\n── AFTER (${DIAGRAM_MODEL}, depiction rules + validator) ──`);
const res = await generateDiagramFor(QUESTION, {
  grade: 'Class 10', subject: 'Science', subSubject: '',
  chapterName: 'Cell — Structure and Functions', maxBytes: CACHED_SVG_MAX_BYTES
});

if (res.status !== 'ok') {
  console.log(`status=${res.status}${res.reason ? ` reason=${res.reason}` : ''}`);
  console.log('NO FIGURE PRODUCED — reported as-is rather than as a pass.');
  process.exit(1);
}
const svg = res.diagram.svg;
const a = validateDepiction(svg);
console.log(svg);
console.log(`\nbytes=${Buffer.byteLength(svg, 'utf8')} shapes=${a.stats.drawings} labels=${a.stats.texts} leaders=${a.stats.leaders}`);
console.log(`validator: ${a.ok ? 'ACCEPTED' : `REJECTED [${a.reason}]`}`);
console.log(`alt: ${res.diagram.alt}`);

// The rule the prompt states: strip every <text> and something recognisable must remain.
const stripped = svg.replace(/<text\b[^>]*>.*?<\/text>/gis, '');
const strippedShapes = validateDepiction(stripped).stats.drawings;
console.log(`\nwith EVERY <text> removed: ${strippedShapes} drawn shape(s) remain ` +
  `— ${strippedShapes >= 3 ? 'still a recognisable figure' : 'NOTHING RECOGNISABLE LEFT'}`);
