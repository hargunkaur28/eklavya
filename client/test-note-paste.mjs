// Proves the paste path never lets a data: URI into the document.
import { imageFilesFrom, createImageHandlers, hasUnresolvedPlaceholder, PLACEHOLDER_NODE } from './src/utils/noteImagePaste.js';

const out = [];
const check = (n, p, d='') => { out.push([n,p]); console.log(`${p?'PASS':'*** FAIL ***'}  ${n}${d?'  — '+d:''}`); };
const wait = (ms) => new Promise(r=>setTimeout(r,ms));

// Editor double. It MODELS SELECTION, because selection is where the real bug lived:
// the previous double's insertContent just pushed onto an array, so it reported a
// clean pass while two real pastes in a row destroyed one another. A double simpler
// than the contract can only confirm what you already believed.
//
// The two ProseMirror behaviours that matter, reproduced:
//   - insertContent inserts INTO the selection, REPLACING it when non-empty
//   - inserting an atom leaves a NodeSelection ON the node just inserted
function fakeEditor() {
  const doc = { type:'doc', content:[] };
  const sel = { from: 0, to: 0 };                       // positions = indices into content
  const place = (node, pos, replaceLen) => {
    doc.content.splice(pos, replaceLen, node);
    sel.from = pos; sel.to = pos + 1;                   // NodeSelection on the new atom
  };
  const chain = {
    focus: () => chain, run: () => true,
    insertContent: (node) => { place(node, sel.from, sel.to - sel.from); return chain; },
    insertContentAt: (pos, node) => { place(node, pos, 0); return chain; },
    // The swap path is modelled too, so a test can observe the placeholder actually
    // becoming an image — and, critically, where the selection is left afterwards.
    setNodeSelection: (pos) => { sel.from = pos; sel.to = pos + 1; return chain; },
    deleteSelection: () => { doc.content.splice(sel.from, sel.to - sel.from); sel.to = sel.from; return chain; },
    command: (fn) => {
      fn({ tr: { replaceSelectionWith: (node) => place(node, sel.from, sel.to - sel.from) }, dispatch: true });
      return chain;
    }
  };
  return {
    doc, chain: () => chain,
    state: {
      // Real walk, so replacePlaceholder/removePlaceholder can find nodes by uploadId.
      // Nodes are yielded in ProseMirror's shape (`node.type.name`), not the plain
      // JSON spec shape they were inserted as — that difference is real, and a double
      // that hid it would let a lookup bug through.
      doc: { descendants(fn) { doc.content.forEach((n, i) => fn({ type: { name: n.type }, attrs: n.attrs || {} }, i)); } },
      selection: sel
    },
    schema:{nodes:{image:{create:(a)=>({type:'image',attrs:a})}}}
  };
}
const fakeFile = (type='image/png', name='shot.png') => ({ type, name, size: 1234 });

console.log('── paste of an image is CONSUMED (default handler never runs) ──');
{
  const ed = fakeEditor();
  let blocked = null;
  const h = createImageHandlers({ upload: async () => 'https://cdn.test/img.png', setBlocked: (b)=>{blocked=b;}, onError: ()=>{} });
  h.editor = ed;
  let prevented = false;
  const consumed = h.handlePaste.call(h, null, { clipboardData: { files:[fakeFile()], items:[] }, preventDefault: ()=>{prevented=true;} });
  check('handlePaste returns true (consumes the event)', consumed === true);
  check('preventDefault was called', prevented);
  await wait(30);
  const json = JSON.stringify(ed.doc);
  // This used to assert the placeholder was STILL THERE after the upload resolved,
  // which only held because the old double could not perform the swap. The contract
  // is the reverse: placeholder while in flight, real image once it lands.
  check('placeholder was swapped for the uploaded image',
    !json.includes(PLACEHOLDER_NODE) && json.includes('https://cdn.test/img.png'), json.slice(0, 90));
  check('document contains ZERO data: URIs', !/data:/i.test(json));
  check('autosave was blocked during upload, then released', blocked === false, `final blocked=${blocked}`);
}

console.log('\n── a text paste is NOT consumed (TipTap keeps handling it) ──');
{
  const h = createImageHandlers({ upload: async()=>null, setBlocked: ()=>{}, onError: ()=>{} });
  h.editor = fakeEditor();
  const consumed = h.handlePaste.call(h, null, { clipboardData:{ files:[], items:[] }, preventDefault(){} });
  check('handlePaste returns false for non-image paste', consumed === false);
}

console.log('\n── drop uses the same path ──');
{
  const ed = fakeEditor();
  const h = createImageHandlers({ upload: async()=>'https://cdn.test/x.png', setBlocked: ()=>{}, onError: ()=>{} });
  h.editor = ed;
  const consumed = h.handleDrop.call(h, null, { dataTransfer:{ files:[fakeFile('image/jpeg')], items:[] }, preventDefault(){} });
  check('handleDrop consumes an image drop', consumed === true);
  await wait(30);
  check('drop reached the same swapped-image end state, no data:',
    JSON.stringify(ed.doc).includes('https://cdn.test/x.png')
      && !JSON.stringify(ed.doc).includes(PLACEHOLDER_NODE)
      && !/data:/i.test(JSON.stringify(ed.doc)));
}

console.log('\n── disallowed types are ignored, not uploaded ──');
{
  check('svg rejected', imageFilesFrom({ files:[fakeFile('image/svg+xml','x.svg')], items:[] }).length === 0);
  check('gif rejected', imageFilesFrom({ files:[fakeFile('image/gif','x.gif')], items:[] }).length === 0);
  check('png accepted', imageFilesFrom({ files:[fakeFile('image/png')], items:[] }).length === 1);
}

console.log('\n── a FAILED upload removes the placeholder (never blocks autosave forever) ──');
{
  const ed = fakeEditor();
  let blocked=null, err=null;
  const h = createImageHandlers({ upload: async()=>{ throw Object.assign(new Error('x'),{code:'NOTE_IMAGE_TOO_LARGE'}); }, setBlocked:(b)=>{blocked=b;}, onError:(c)=>{err=c;} });
  h.editor = ed;
  h.handlePaste.call(h, null, { clipboardData:{files:[fakeFile()],items:[]}, preventDefault(){} });
  await wait(40);
  check('error surfaced to the UI', err === 'NOTE_IMAGE_TOO_LARGE', err);
  check('autosave released after the failure', blocked === false, `blocked=${blocked}`);
}

console.log('\n── a second paste must not destroy the first placeholder ──');
// Regression. Caught in the browser, not here: two pastes ~300ms apart yielded ONE
// image. handlePaste ran both times, but the second insert landed on the NodeSelection
// covering the first placeholder and replaced it. The first upload then resolved
// against a node that no longer existed — no image, no error, and its Cloudinary
// asset orphaned. Silent data loss on an ordinary two-screenshot paste.
{
  const ed = fakeEditor();
  let release;
  const h = createImageHandlers({
    upload: () => new Promise((r) => { release = r; }),   // both stay in flight
    setBlocked: () => {}, onError: () => {}
  });
  h.editor = ed;
  h.handlePaste.call(h, null, { clipboardData:{files:[fakeFile('image/png','a.png')],items:[]}, preventDefault(){} });
  await wait(10);
  h.handlePaste.call(h, null, { clipboardData:{files:[fakeFile('image/png','b.png')],items:[]}, preventDefault(){} });
  await wait(10);
  const holders = ed.doc.content.filter((n) => n.type === PLACEHOLDER_NODE);
  check('both placeholders coexist while both uploads are in flight',
    holders.length === 2, `${holders.length} placeholder(s)`);
  check('they carry distinct uploadIds',
    new Set(holders.map((n) => n.attrs.uploadId)).size === 2);
  check('the first paste is still the first node, in paste order',
    holders[0]?.attrs.name === 'a.png' && holders[1]?.attrs.name === 'b.png',
    holders.map((n) => n.attrs.name).join(','));
  release?.(null);
}

console.log('\n── two images in ONE paste must not destroy each other ──');
// The same hazard reached a different way. handleFiles AWAITS each upload inside the
// loop, so file 2 is inserted only after file 1 has already become an image — and the
// swap leaves a NodeSelection on that image. Under the old insertContent the second
// insert replaced the first image outright, so a two-screenshot paste kept one.
{
  const ed = fakeEditor();
  let n = 0;
  const h = createImageHandlers({
    upload: async () => `https://res.cloudinary.com/x/${++n}.jpg`,
    setBlocked: () => {}, onError: () => {}
  });
  h.editor = ed;
  h.handlePaste.call(h, null, {
    clipboardData:{ files:[fakeFile('image/png','one.png'), fakeFile('image/png','two.png')], items:[] },
    preventDefault(){}
  });
  await wait(60);
  const imgs = ed.doc.content.filter((x) => x.type === 'image');
  check('a two-image paste ends with two images', imgs.length === 2, `${imgs.length} image(s)`);
  check('both URLs survive — neither overwrote the other',
    new Set(imgs.map((x) => x.attrs.src)).size === 2, imgs.map((x) => x.attrs.src).join(' '));
  check('no placeholder left behind',
    ed.doc.content.every((x) => x.type !== PLACEHOLDER_NODE));
}

console.log('\n── hasUnresolvedPlaceholder detects a mid-upload document ──');
{
  check('detects nested placeholder', hasUnresolvedPlaceholder({type:'doc',content:[{type:'paragraph',content:[{type:PLACEHOLDER_NODE}]}]}));
  check('clean doc reports false', !hasUnresolvedPlaceholder({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'hi'}]}]}));
}

const failed = out.filter(([,p])=>!p);
console.log(`\n${out.length-failed.length}/${out.length} checks passed`);
if(failed.length){console.log('FAILED:');failed.forEach(([n])=>console.log('  - '+n));process.exit(1);}
