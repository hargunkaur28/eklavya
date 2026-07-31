// Generates the client-facing Feature Overview PDF at docs/Eklavya-Feature-Overview.pdf.
//
//   node server/src/scripts/generateFeaturePdf.mjs
//
// Standalone by design: no Express route, no database, no API key, no network.
// It reuses the same rendering path as the in-product study-notes PDF
// (@react-pdf/renderer + the ported vector Eklavya logo from utils/notesPdf.js)
// so the branding matches what students already download.
//
// CONTENT RULE — every statement in this document is traceable to the codebase;
// see README.md. No invented statistics, testimonials, partnerships or
// certifications, and no roadmap promises. Sarvam AI is the only provider named
// (the Hindi capability is the reason a state client cares which models are
// underneath). Every other provider, model name, endpoint, schema field and file
// name is deliberately absent, as are all limitations and fallback behaviour.
//
// DESIGN RULE — every colour and radius below is lifted from
// client/src/styles.css so the document belongs to the product. Nothing is
// invented; the section accents are the greens the stylesheet already uses.
//
// Fonts: react-pdf's built-in Helvetica has no Devanagari coverage and the repo
// ships no font file, so the document is Latin-script only (one family, three
// weights). The tagline is romanised exactly as notesPdf.js renders it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import React from 'react';
import {
  Document, Page, View, Text, StyleSheet, Svg, Path, Circle, Rect, Line, Polyline, Font, renderToFile
} from '@react-pdf/renderer';

// react-pdf hyphenates by default, which broke headings mid-word ("Each Stu-dent").
// Returning the word whole disables it document-wide.
Font.registerHyphenationCallback((word) => [word]);

const e = React.createElement;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const OUT_DIR = path.join(REPO_ROOT, 'docs');
const OUT_FILE = path.join(OUT_DIR, 'Eklavya-Feature-Overview.pdf');

// react-pdf defaults CreationDate to `new Date()`, which would make every
// regeneration a different file. Pinning keeps re-runs byte-identical.
const FIXED_DATE = new Date('2024-01-01T00:00:00Z');

// ════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS — all extracted from client/src/styles.css (line refs noted).
// Do not hardcode a colour anywhere below; style from this object only.
// ════════════════════════════════════════════════════════════════════════════
const tokens = {
  color: {
    brand: '#2F6B3A',        // --base; the dominant brand green (178 uses)
    brandDeep: '#255730',    // darker green already in the stylesheet
    brandMid: '#3D8A4A',     // lighter green already in the stylesheet
    leaf: '#66BB6A',         // the logo's light-green leaves (from EklavyaLogo.jsx)
    accent: '#E07A3E',       // the orange accent
    ink: '#1F2A1F',          // --pill-text / --diagram-ink; primary text
    muted: '#6B6357',        // secondary text
    mutedGreen: '#6B7C6B',   // tertiary text on tinted surfaces
    cream: '#FAF6EC',        // page background of the app
    surface: '#FFFFFF',      // --pill-bg
    surfaceWarm: '#FFFDF9',  // card surface
    surfaceTint: '#FCFBF7',  // subtler card surface
    surfaceGreen: '#F4F8F2', // green-tinted surface
    border: '#E4DAC5',       // the standard hairline border
    borderWarm: '#EAE3D2',   // softer hairline
    borderGreen: '#DCE8D8',  // green-tinted border
    dark: '#2C2A24',         // the dark surface used for code blocks
    inverse: '#F5F1E6',      // text on the dark surface
    onBrand: '#FFFFFF'       // --hover-text
  },
  // Translucent whites for text sitting on a brand-coloured panel. rgba works for
  // fills and text; for BORDERS react-pdf renders it as an unrelated colour, so
  // every border on a coloured panel is an opaque mix() of that panel with white
  // instead (see `onPanel` below). box-shadow and CSS gradients are unsupported.
  alpha: {
    w08: 'rgba(255,255,255,0.08)',
    w14: 'rgba(255,255,255,0.14)',
    w22: 'rgba(255,255,255,0.22)',
    w60: 'rgba(255,255,255,0.60)',
    w75: 'rgba(255,255,255,0.75)',
    w85: 'rgba(255,255,255,0.85)'
  },
  radius: { sm: 6, md: 10, lg: 12, xl: 14, xxl: 18, pill: 999 }, // all present in styles.css
  font: { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' },
  size: { cover: 40, section: 24, cardTitle: 12, body: 9.5, small: 8.5, eyebrow: 7, micro: 6.5 },
  space: { pageX: 46, pageTop: 46, pageBottom: 52 }
};

const T = tokens.color;

// Opaque blend of two token colours. Used only to derive borders/tiles that sit
// on a coloured panel — the inputs are always tokens, so nothing new is invented.
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

// Borders and tiles for elements sitting on a panel of colour `bg`.
const onPanel = (bg) => ({
  border: mix(bg, T.surface, 0.28),
  tile: mix(bg, T.surface, 0.20),
  fill: mix(bg, T.surface, 0.09)
});

// Section accents: the brand hue varied across the greens the stylesheet already
// contains, plus the real orange accent. No new hues are introduced.
const ACCENTS = {
  idea: T.brand,
  journey: T.brandDeep,
  engine: T.accent,
  core: T.brand,
  language: T.brandMid,
  fit: T.brandDeep,
  oversight: T.brand,
  privacy: T.ink
};

// ── Logo (vector) ───────────────────────────────────────────────────────────
// Paths copied from server/src/utils/notesPdf.js, which ports EklavyaLogo.jsx.
// It always renders in its real colours: flattened to a single white it loses
// its layered leaves and reads as a blob, so on brand-coloured pages it sits on
// a light tile instead (see `brandTile`).
function Logo({ size = 30 }) {
  const g = T.brand;
  const o = T.accent;
  const l = T.leaf;
  return e(
    Svg,
    { width: size, height: size, viewBox: '0 0 120 120' },
    e(Path, { d: 'M56 46C51 28 36 14 30 6C44 4 58 18 56 46Z', fill: g }),
    e(Path, { d: 'M64 46C69 28 84 14 90 6C76 4 62 18 64 46Z', fill: g }),
    e(Path, { d: 'M60 40V68', stroke: g, strokeWidth: 4.5, strokeLinecap: 'round' }),
    e(Path, { d: 'M60 88C38 76 16 78 8 88C24 104 50 102 60 88Z', fill: g }),
    e(Path, { d: 'M60 88C82 76 104 78 112 88C96 104 70 102 60 88Z', fill: g }),
    e(Path, { d: 'M60 76C40 66 22 68 15 76C28 90 48 88 60 76Z', fill: o }),
    e(Path, { d: 'M60 76C80 66 98 68 105 76C92 90 72 88 60 76Z', fill: o }),
    e(Path, { d: 'M60 64C44 56 30 58 24 64C34 76 50 74 60 64Z', fill: l }),
    e(Path, { d: 'M60 64C76 56 90 58 96 64C86 76 70 74 60 64Z', fill: l })
  );
}

// ── Icons ───────────────────────────────────────────────────────────────────
// react-pdf has no icon library and lucide-react would emit DOM elements, so
// these are hand-drawn stroke paths on a 24×24 box.
const ICONS = {
  target: (c, w) => [e(Circle, { key: 1, cx: 12, cy: 12, r: 8.5, stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Circle, { key: 2, cx: 12, cy: 12, r: 4, stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Circle, { key: 3, cx: 12, cy: 12, r: 1, fill: c })],
  map: (c, w) => [e(Polyline, { key: 1, points: '3,7 9,4 15,7 21,4 21,17 15,20 9,17 3,20 3,7', stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Line, { key: 2, x1: 9, y1: 4, x2: 9, y2: 17, stroke: c, strokeWidth: w }),
                  e(Line, { key: 3, x1: 15, y1: 7, x2: 15, y2: 20, stroke: c, strokeWidth: w })],
  book: (c, w) => [e(Path, { key: 1, d: 'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4Z', stroke: c, strokeWidth: w, fill: 'none' }),
                   e(Path, { key: 2, d: 'M20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6Z', stroke: c, strokeWidth: w, fill: 'none' })],
  play: (c, w) => [e(Circle, { key: 1, cx: 12, cy: 12, r: 8.5, stroke: c, strokeWidth: w, fill: 'none' }),
                   e(Path, { key: 2, d: 'M10 8.5 16 12l-6 3.5Z', fill: c })],
  check: (c, w) => [e(Path, { key: 1, d: 'M4 6h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z', stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Polyline, { key: 2, points: '7.5,13 10.5,16 16.5,9', stroke: c, strokeWidth: w, fill: 'none' })],
  chart: (c, w) => [e(Line, { key: 1, x1: 4, y1: 20, x2: 20, y2: 20, stroke: c, strokeWidth: w }),
                    e(Rect, { key: 2, x: 6, y: 12, width: 3.4, height: 7, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Rect, { key: 3, x: 11, y: 8, width: 3.4, height: 11, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Rect, { key: 4, x: 16, y: 14, width: 3.4, height: 5, stroke: c, strokeWidth: w, fill: 'none' })],
  refresh: (c, w) => [e(Path, { key: 1, d: 'M20 12a8 8 0 1 1-2.6-5.9', stroke: c, strokeWidth: w, fill: 'none' }),
                      e(Polyline, { key: 2, points: '20,3 20,7 16,7', stroke: c, strokeWidth: w, fill: 'none' })],
  pen: (c, w) => [e(Path, { key: 1, d: 'M4 20l1.2-4.2L15.5 5.5a2 2 0 0 1 3 3L8.2 18.8Z', stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Line, { key: 2, x1: 14, y1: 7, x2: 17, y2: 10, stroke: c, strokeWidth: w })],
  layers: (c, w) => [e(Path, { key: 1, d: 'M12 3.5 21 8l-9 4.5L3 8Z', stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Polyline, { key: 2, points: '3,12.5 12,17 21,12.5', stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Polyline, { key: 3, points: '3,16.5 12,21 21,16.5', stroke: c, strokeWidth: w, fill: 'none' })],
  flame: (c, w) => [e(Path, { key: 1, d: 'M12 3c3.5 4 6 6.2 6 10a6 6 0 0 1-12 0c0-2 1-3.4 2.2-4.6C9 10.6 10 12 11 12c1 0 1.4-1.2.6-3C11 7.2 11.2 5 12 3Z', stroke: c, strokeWidth: w, fill: 'none' })],
  globe: (c, w) => [e(Circle, { key: 1, cx: 12, cy: 12, r: 8.5, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Line, { key: 2, x1: 3.5, y1: 12, x2: 20.5, y2: 12, stroke: c, strokeWidth: w }),
                    e(Path, { key: 3, d: 'M12 3.5c4 4.5 4 12.5 0 17M12 3.5c-4 4.5-4 12.5 0 17', stroke: c, strokeWidth: w, fill: 'none' })],
  speaker: (c, w) => [e(Path, { key: 1, d: 'M4 9.5h3.5L12 5.5v13L7.5 14.5H4Z', stroke: c, strokeWidth: w, fill: 'none' }),
                      e(Path, { key: 2, d: 'M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11', stroke: c, strokeWidth: w, fill: 'none' })],
  mic: (c, w) => [e(Rect, { key: 1, x: 9, y: 3, width: 6, height: 10.5, rx: 3, stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Path, { key: 2, d: 'M5.5 11.5a6.5 6.5 0 0 0 13 0', stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Line, { key: 3, x1: 12, y1: 18, x2: 12, y2: 21, stroke: c, strokeWidth: w })],
  sliders: (c, w) => [e(Line, { key: 1, x1: 4, y1: 7, x2: 20, y2: 7, stroke: c, strokeWidth: w }),
                      e(Line, { key: 2, x1: 4, y1: 12, x2: 20, y2: 12, stroke: c, strokeWidth: w }),
                      e(Line, { key: 3, x1: 4, y1: 17, x2: 20, y2: 17, stroke: c, strokeWidth: w }),
                      e(Circle, { key: 4, cx: 9, cy: 7, r: 2.2, fill: c }),
                      e(Circle, { key: 5, cx: 15, cy: 12, r: 2.2, fill: c }),
                      e(Circle, { key: 6, cx: 8, cy: 17, r: 2.2, fill: c })],
  chat: (c, w) => [e(Path, { key: 1, d: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4Z', stroke: c, strokeWidth: w, fill: 'none' })],
  cap: (c, w) => [e(Path, { key: 1, d: 'M12 4 22 9l-10 5L2 9Z', stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Path, { key: 2, d: 'M6 11.5V17c0 1.7 2.7 3 6 3s6-1.3 6-3v-5.5', stroke: c, strokeWidth: w, fill: 'none' })],
  notes: (c, w) => [e(Rect, { key: 1, x: 5, y: 3, width: 14, height: 18, rx: 2, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Line, { key: 2, x1: 8.5, y1: 8, x2: 15.5, y2: 8, stroke: c, strokeWidth: w }),
                    e(Line, { key: 3, x1: 8.5, y1: 12, x2: 15.5, y2: 12, stroke: c, strokeWidth: w }),
                    e(Line, { key: 4, x1: 8.5, y1: 16, x2: 13, y2: 16, stroke: c, strokeWidth: w })],
  users: (c, w) => [e(Circle, { key: 1, cx: 9, cy: 8, r: 3.4, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Path, { key: 2, d: 'M3 20a6 6 0 0 1 12 0', stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Circle, { key: 3, cx: 17.5, cy: 9, r: 2.6, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Path, { key: 4, d: 'M15 20a5 5 0 0 1 6.5-4.3', stroke: c, strokeWidth: w, fill: 'none' })],
  shield: (c, w) => [e(Path, { key: 1, d: 'M12 3 20 6v6c0 4.6-3.2 7.7-8 9-4.8-1.3-8-4.4-8-9V6Z', stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Polyline, { key: 2, points: '8.5,12 11,14.5 15.5,9.5', stroke: c, strokeWidth: w, fill: 'none' })],
  lock: (c, w) => [e(Rect, { key: 1, x: 5, y: 10.5, width: 14, height: 10, rx: 2, stroke: c, strokeWidth: w, fill: 'none' }),
                   e(Path, { key: 2, d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5', stroke: c, strokeWidth: w, fill: 'none' })],
  eyeOff: (c, w) => [e(Path, { key: 1, d: 'M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z', stroke: c, strokeWidth: w, fill: 'none' }),
                     e(Line, { key: 2, x1: 4.5, y1: 20, x2: 19.5, y2: 4, stroke: c, strokeWidth: w })],
  pin: (c, w) => [e(Path, { key: 1, d: 'M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z', stroke: c, strokeWidth: w, fill: 'none' }),
                  e(Circle, { key: 2, cx: 12, cy: 10, r: 2.6, stroke: c, strokeWidth: w, fill: 'none' })],
  phone: (c, w) => [e(Rect, { key: 1, x: 7, y: 2.5, width: 10, height: 19, rx: 2.4, stroke: c, strokeWidth: w, fill: 'none' }),
                    e(Line, { key: 2, x1: 10.5, y1: 18.5, x2: 13.5, y2: 18.5, stroke: c, strokeWidth: w })],
  spark: (c, w) => [e(Path, { key: 1, d: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2Z', stroke: c, strokeWidth: w, fill: 'none' })]
};

const Icon = ({ name, size = 12, color = T.onBrand, weight = 1.7 }) =>
  e(Svg, { width: size, height: size, viewBox: '0 0 24 24' }, ...(ICONS[name] || ICONS.spark)(color, weight));

// ════════════════════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  // ── Full-bleed pages: padding 0 so the colour reaches all four edges ──────
  bleed: { padding: 0, backgroundColor: T.brand, fontFamily: tokens.font.regular, color: T.onBrand },
  bleedInner: { paddingHorizontal: 52, paddingTop: 54, paddingBottom: 46, height: '100%' },

  brandRow: { flexDirection: 'row', alignItems: 'center' },
  // The logo is kept in its real colours on a light tile: recoloured to a single
  // white it loses its layered leaves and reads as a blob.
  brandTile: { width: 44, height: 44, borderRadius: tokens.radius.lg, backgroundColor: T.cream, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 13, fontFamily: tokens.font.bold, color: T.onBrand, letterSpacing: 3, marginLeft: 9 },
  brandTag: { fontSize: tokens.size.micro, color: tokens.alpha.w60, letterSpacing: 0.8, marginLeft: 9, marginTop: 1 },

  coverEyebrow: { fontSize: tokens.size.eyebrow, fontFamily: tokens.font.bold, color: tokens.alpha.w60, letterSpacing: 1.8, marginBottom: 12 },
  coverHead: { fontSize: tokens.size.cover, fontFamily: tokens.font.bold, color: T.onBrand, lineHeight: 1.12, letterSpacing: -0.6 },
  coverRule: { height: 2.5, width: 58, backgroundColor: T.accent, marginTop: 22, marginBottom: 20, borderRadius: tokens.radius.pill },
  coverSub: { fontSize: 11, color: tokens.alpha.w85, lineHeight: 1.65, maxWidth: 400 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 22 },
  chip: { backgroundColor: onPanel(T.brand).tile, borderRadius: tokens.radius.pill, paddingVertical: 4.5, paddingHorizontal: 11, marginRight: 7, marginBottom: 7 },
  chipText: { fontSize: tokens.size.small, color: T.onBrand, letterSpacing: 0.3 },

  statBox: { flexDirection: 'row', borderWidth: 1, borderColor: onPanel(T.brand).border, borderRadius: tokens.radius.xxl, backgroundColor: onPanel(T.brand).fill, padding: 16 },
  statCell: { flex: 1, paddingRight: 8 },
  statNum: { fontSize: 20, fontFamily: tokens.font.bold, color: T.onBrand, letterSpacing: -0.4 },
  statCap: { fontSize: tokens.size.micro, color: tokens.alpha.w60, letterSpacing: 0.9, marginTop: 4, lineHeight: 1.4 },

  // ── Interior pages ───────────────────────────────────────────────────────
  page: {
    backgroundColor: T.surface,
    paddingTop: tokens.space.pageTop,
    paddingBottom: tokens.space.pageBottom,
    paddingHorizontal: tokens.space.pageX,
    fontSize: tokens.size.body,
    color: T.ink,
    lineHeight: 1.5,
    fontFamily: tokens.font.regular
  },
  // The footer is two independently-anchored Texts rather than a flex row. A
  // `position: absolute` row anchored by `bottom` is unreliable here: without an
  // explicit height the layout engine stretches it thousands of points and draws
  // its text off the top of the page; with one, the row's children collapse to
  // zero width and emit no glyphs at all. Anchoring each Text directly sidesteps
  // both. Verified by rasterising, not by reading the code.
  // The footer is anchored by `top`, not `bottom`. Anchoring an absolute box by
  // `bottom` is unusable here: with no explicit height the layout engine
  // stretches it to a six-figure height and draws its contents far off the page,
  // and with one its Text children collapse to zero width and emit no glyphs at
  // all. The page number makes it worse — a `render`-driven Text has no content
  // when the page is laid out, so it never has an intrinsic size to fall back on.
  // Top-anchoring resolves normally, which is why the running header pattern
  // works. A4 is 841.89pt tall, so these sit ~25pt from the foot.
  footerRule: { position: 'absolute', top: 801.9, left: tokens.space.pageX, right: tokens.space.pageX, height: 0.8, backgroundColor: T.border },
  footerRow: { position: 'absolute', top: 808, left: tokens.space.pageX, right: tokens.space.pageX, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: tokens.size.micro, color: T.muted, letterSpacing: 0.8 },
  footerNumBox: { width: 12 },
  footerNum: { fontSize: tokens.size.micro, color: T.muted, letterSpacing: 0.8, textAlign: 'right' },

  // ── Section opener banner ────────────────────────────────────────────────
  banner: { borderRadius: tokens.radius.xxl, padding: 16, marginBottom: 14 },
  bannerTop: { flexDirection: 'row', alignItems: 'flex-start' },
  bannerTile: { width: 30, height: 30, borderRadius: tokens.radius.md, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  bannerMid: { flex: 1 },
  bannerEyebrow: { fontSize: tokens.size.eyebrow, fontFamily: tokens.font.bold, color: tokens.alpha.w75, letterSpacing: 1.8, marginBottom: 5 },
  bannerTitle: { fontSize: tokens.size.section, fontFamily: tokens.font.bold, color: T.onBrand, letterSpacing: -0.4, lineHeight: 1.15 },
  bannerBadge: { borderWidth: 1, borderRadius: tokens.radius.pill, paddingVertical: 3.5, paddingHorizontal: 9 },
  bannerBadgeText: { fontSize: tokens.size.micro, fontFamily: tokens.font.bold, color: T.onBrand, letterSpacing: 0.9 },
  bannerDesc: { fontSize: tokens.size.body, color: tokens.alpha.w85, lineHeight: 1.5, marginTop: 9 },

  // Marks a page that carries on a section rather than opening one, so it does
  // not read as a page whose banner went missing.
  contd: { flexDirection: 'row', alignItems: 'center', marginBottom: 13 },
  contdBar: { width: 16, height: 2, borderRadius: tokens.radius.pill, marginRight: 8 },
  contdText: { fontSize: tokens.size.eyebrow, fontFamily: tokens.font.bold, color: T.muted, letterSpacing: 1.6 },

  // ── Feature cards ────────────────────────────────────────────────────────
  cardRow: { flexDirection: 'row', marginBottom: 8 },
  card: {
    borderWidth: 1, borderColor: T.border, backgroundColor: T.surfaceWarm,
    borderRadius: tokens.radius.xl, padding: 11, marginBottom: 8
  },
  cardHalf: { width: '48%' },
  cardGap: { width: '4%' },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  cardTile: { width: 20, height: 20, borderRadius: tokens.radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  cardTitle: { fontSize: tokens.size.cardTitle, fontFamily: tokens.font.bold, color: T.ink, flex: 1, lineHeight: 1.25 },
  cardSummary: { fontSize: tokens.size.small, color: T.muted, lineHeight: 1.45, marginBottom: 6 },
  cardBullet: { flexDirection: 'row', marginBottom: 3 },
  cardBulletMark: { width: 11, paddingTop: 2 },
  cardBulletText: { flex: 1, fontSize: tokens.size.body, color: T.ink, lineHeight: 1.45 },

  // ── Prose blocks ─────────────────────────────────────────────────────────
  h2: { fontSize: 11.5, fontFamily: tokens.font.bold, color: T.brand, marginTop: 4, marginBottom: 6 },
  p: { fontSize: tokens.size.body, color: T.ink, lineHeight: 1.55, marginBottom: 9 },
  pLast: { fontSize: tokens.size.body, color: T.ink, lineHeight: 1.55 },

  // Numbered journey steps.
  step: { flexDirection: 'row', marginBottom: 9 },
  stepNum: { width: 21, height: 21, borderRadius: tokens.radius.sm, backgroundColor: T.surfaceGreen, borderWidth: 1, borderColor: T.borderGreen, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  stepNumText: { fontSize: tokens.size.small, fontFamily: tokens.font.bold, color: T.brand },
  stepBody: { flex: 1 },
  stepName: { fontSize: 10.5, fontFamily: tokens.font.bold, color: T.ink, marginBottom: 1.5 },
  stepText: { fontSize: tokens.size.body, color: T.ink, lineHeight: 1.45 },

  // Quiet callout on a light page.
  note: { backgroundColor: T.surfaceGreen, borderWidth: 1, borderColor: T.borderGreen, borderRadius: tokens.radius.lg, padding: 12, marginTop: 2 },
  noteTitle: { fontSize: 10, fontFamily: tokens.font.bold, color: T.brand, marginBottom: 4 },
  noteText: { fontSize: tokens.size.body, color: T.ink, lineHeight: 1.5 },

  // ── Privacy: deliberately a statement, not another card ───────────────────
  darkPanel: { backgroundColor: T.ink, borderRadius: tokens.radius.xxl, padding: 18, marginBottom: 12 },
  darkTitle: { fontSize: 13, fontFamily: tokens.font.bold, color: T.inverse, marginBottom: 4 },
  darkLede: { fontSize: tokens.size.body, color: tokens.alpha.w75, lineHeight: 1.55, marginBottom: 12 },
  darkItem: { flexDirection: 'row', marginBottom: 8 },
  darkMark: { width: 15, paddingTop: 1.5 },
  darkItemBody: { flex: 1 },
  darkItemTitle: { fontSize: tokens.size.body, fontFamily: tokens.font.bold, color: T.inverse, marginBottom: 1 },
  darkItemText: { fontSize: tokens.size.body, color: tokens.alpha.w75, lineHeight: 1.45 },

  // ── Closing summary tiles ────────────────────────────────────────────────
  tileRow: { flexDirection: 'row', marginTop: 4 },
  tile: { flex: 1, borderWidth: 1, borderColor: onPanel(T.brand).border, backgroundColor: onPanel(T.brand).fill, borderRadius: tokens.radius.lg, padding: 13 },
  tileGap: { width: 10 },
  tileLabel: { fontSize: tokens.size.micro, fontFamily: tokens.font.bold, color: T.accent, letterSpacing: 1.1, marginBottom: 5 },
  tileText: { fontSize: tokens.size.small, color: tokens.alpha.w85, lineHeight: 1.5 }
});

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ════════════════════════════════════════════════════════════════════════════
const Footer = () => [
  e(View, { key: 'fr', fixed: true, style: s.footerRule }),
  e(View, { key: 'ft', fixed: true, style: s.footerRow },
    e(Text, { style: s.footerText }, 'PROJECT EKLAVYA  ·  FEATURE OVERVIEW'),
    e(View, { style: s.footerNumBox },
      e(Text, { style: s.footerNum, render: ({ pageNumber }) => String(pageNumber).padStart(2, '0') })))
];

const Banner = ({ n, accent, icon, title, desc, badge }) => {
  const p = onPanel(accent);
  return e(View, { style: [s.banner, { backgroundColor: accent }], wrap: false },
    e(View, { style: s.bannerTop },
      e(View, { style: [s.bannerTile, { backgroundColor: p.tile }] }, e(Icon, { name: icon, size: 15 })),
      e(View, { style: s.bannerMid },
        e(Text, { style: s.bannerEyebrow }, `SECTION ${n}`),
        e(Text, { style: s.bannerTitle }, title)
      ),
      badge ? e(View, { style: [s.bannerBadge, { borderColor: p.border, backgroundColor: p.fill }] },
        e(Text, { style: s.bannerBadgeText }, badge.toUpperCase())) : null
    ),
    e(Text, { style: s.bannerDesc }, desc)
  );
};

const Contd = (accent, label) => e(View, { key: 'contd', style: s.contd },
  e(View, { style: [s.contdBar, { backgroundColor: accent }] }),
  e(Text, { style: s.contdText }, label.toUpperCase()));

const CheckMark = (accent) => e(Svg, { width: 7.5, height: 7.5, viewBox: '0 0 24 24' },
  e(Polyline, { points: '3,13 9,19 21,5', stroke: accent, strokeWidth: 3.6, fill: 'none' }));

const Card = (accent, { icon, title, summary, points = [] }, half) =>
  e(View, { key: title, style: half ? [s.card, s.cardHalf] : s.card, wrap: false },
    e(View, { style: s.cardHead },
      e(View, { style: [s.cardTile, { backgroundColor: accent }] }, e(Icon, { name: icon, size: 11 })),
      e(Text, { style: s.cardTitle }, title)
    ),
    summary ? e(Text, { style: s.cardSummary }, summary) : null,
    ...points.map((pt, i) => e(View, { key: i, style: s.cardBullet },
      e(View, { style: s.cardBulletMark }, CheckMark(accent)),
      e(Text, { style: s.cardBulletText }, pt)
    ))
  );

// Two cards side by side; keeps the vertical rhythm when content is short.
const CardPair = (accent, a, b) => e(View, { key: a.title + b.title, style: s.cardRow },
  Card(accent, a, true), e(View, { style: s.cardGap }), Card(accent, b, true)
);

const Step = (n, name, text) => e(View, { key: n, style: s.step, wrap: false },
  e(View, { style: s.stepNum }, e(Text, { style: s.stepNumText }, String(n))),
  e(View, { style: s.stepBody },
    e(Text, { style: s.stepName }, name),
    e(Text, { style: s.stepText }, text)
  )
);

const DarkItem = (title, text) => e(View, { key: title, style: s.darkItem, wrap: false },
  e(View, { style: s.darkMark }, CheckMark(T.accent)),
  e(View, { style: s.darkItemBody },
    e(Text, { style: s.darkItemTitle }, title),
    e(Text, { style: s.darkItemText }, text)
  )
);

const Sheet = (children) => e(Page, { size: 'A4', style: s.page }, ...children, ...Footer());

// ════════════════════════════════════════════════════════════════════════════
// DOCUMENT
// ════════════════════════════════════════════════════════════════════════════
function FeatureOverview() {
  return e(
    Document,
    {
      title: 'Project Eklavya — Feature Overview',
      author: 'Project Eklavya',
      subject: 'What Project Eklavya does, for students, parents and education departments',
      creationDate: FIXED_DATE,
      modificationDate: FIXED_DATE
    },

    // ═══ Cover — full bleed, padding 0 on the Page ═══════════════════════════
    e(Page, { size: 'A4', style: s.bleed },
      e(View, { style: s.bleedInner },
        e(View, { style: s.brandRow },
          e(View, { style: s.brandTile }, e(Logo, { size: 32 })),
          e(View, null,
            e(Text, { style: s.brandName }, 'EKLAVYA'),
            e(Text, { style: s.brandTag }, 'Ek Shikshak, Har Vidhyarthi')
          )
        ),

        e(View, { style: { marginTop: 150 } },
          e(Text, { style: s.coverEyebrow }, 'FEATURE OVERVIEW'),
          e(Text, { style: s.coverHead }, 'A study plan built\nfor every single\nstudent.'),
          e(View, { style: s.coverRule }),
          e(Text, { style: s.coverSub },
            'Project Eklavya is an AI-powered personalised learning platform. It finds out what each ' +
            'student already knows, then generates a day-by-day study plan for that student alone — ' +
            'in English or in Hindi.'
          ),
          e(View, { style: s.chipRow },
            ...['Adaptive Assessment', 'Personalised Roadmap', 'Bilingual', 'AI Tutor'].map((c) =>
              e(View, { key: c, style: s.chip }, e(Text, { style: s.chipText }, c)))
          )
        ),

        // Stat strip — every figure is read out of the code, none invented.
        e(View, { style: { marginTop: 'auto' } },
          e(View, { style: s.statBox },
            e(View, { style: s.statCell },
              e(Text, { style: s.statNum }, '8–20'),
              e(Text, { style: s.statCap }, 'ADAPTIVE QUESTIONS\nPER ASSESSMENT')),
            e(View, { style: s.statCell },
              e(Text, { style: s.statNum }, '10–15'),
              e(Text, { style: s.statCap }, 'DAY PERSONALISED\nSTUDY PLAN')),
            e(View, { style: s.statCell },
              e(Text, { style: s.statNum }, '70%'),
              e(Text, { style: s.statCap }, 'PASS MARK TO\nCLOSE A STUDY DAY')),
            e(View, { style: [s.statCell, { paddingRight: 0 }] },
              e(Text, { style: s.statNum }, '2'),
              e(Text, { style: s.statCap }, 'LANGUAGES, END\nTO END'))
          )
        )
      )
    ),

    // ═══ 01 — What Eklavya Is ════════════════════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '01', accent: ACCENTS.idea, icon: 'spark',
        title: 'What Eklavya Is',
        desc: 'One teacher, forty students, one lesson at one pace. Eklavya does not replace that ' +
              'teacher. It uses AI to give each of those forty students a study plan written for them alone.'
      }),
      e(Text, { key: 'h1', style: s.h2 }, 'The problem'),
      e(Text, { key: 'p1', style: s.p },
        'In a full classroom every student hears the same explanation on the same day, whether or not ' +
        'they were ready for it. A teacher can usually tell that a student is falling behind. What no ' +
        'teacher can do is sit with each of forty students, work out exactly which chapters are shaky, ' +
        'write forty different study plans — and then rewrite all forty next week as those students ' +
        'change. That is not a question of effort or skill. It is arithmetic.'
      ),
      e(Text, { key: 'p2', style: s.p },
        'So the gaps stay hidden. A student who never quite understood one chapter carries that gap ' +
        'into every chapter built on it, and by the board exam nobody knows where it started.'
      ),
      e(Text, { key: 'h2', style: s.h2 }, 'What Eklavya does about it'),
      e(Text, { key: 'p3', style: s.p },
        'Eklavya is AI-first, and that is the point. Nothing in it is a pre-written course sitting on a ' +
        'shelf. The assessment questions, the study plan, the daily lessons, the quizzes, the marking of ' +
        'written answers and the tutoring are all generated for the individual student — from that ' +
        'student’s own syllabus and that student’s own results. Writing forty study plans a week is ' +
        'exactly the kind of work a machine can do and a person cannot.'
      ),
      e(Text, { key: 'p4', style: s.p },
        'It begins by finding out what the student actually knows, chapter by chapter, through a short ' +
        'assessment that adapts as they answer. It then generates a study plan from that result: weak ' +
        'chapters get more days, strong chapters get brief revision, and chapters the assessment did ' +
        'not manage to reach are still included at normal pace rather than quietly dropped.'
      ),
      e(Text, { key: 'p5', style: s.p },
        'Each day of the plan is a complete piece of work — a written lesson, video teaching and a quiz. ' +
        'The day closes only when the video has been watched and the quiz passed. As results come in the ' +
        'plan changes: if a student keeps getting the same sub-topic wrong, an extra day on that ' +
        'sub-topic is generated and added to their plan.'
      ),
      e(View, { key: 'note', style: s.note, wrap: false },
        e(Text, { style: s.noteTitle }, 'What Eklavya is not'),
        e(Text, { style: s.noteText },
          'It is not a video library, a question bank, or a fixed course that every student walks past ' +
          'in the same order. The lesson, the videos, the quiz and the sequence they arrive in are ' +
          'produced for one student, from their syllabus and their results.'
        )
      )
    ]),

    // ═══ 02 — The student journey ════════════════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '02', accent: ACCENTS.journey, icon: 'map',
        title: 'How It Works for a Student', badge: '8 steps',
        desc: 'What a student actually does, from the first time they open Eklavya to the point where ' +
              'the plan starts adapting around them.'
      }),
      Step(1, 'They create an account',
        'An email address and a password of at least eight characters, including a capital letter, a ' +
        'number and a symbol.'),
      Step(2, 'Eklavya asks who they are',
        'A short guided flow asks one question per screen: age, board, father’s name, school, and city ' +
        'or village. A final, clearly marked step offers optional details, every one skippable in a ' +
        'single tap.'),
      Step(3, 'They choose what to study',
        'A class and a subject. For English, Science and Social Science they also choose an area — ' +
        'Grammar, Physics, History and so on — or a combined option spanning all of them. Each choice ' +
        'becomes its own course, with its own assessment and plan.'),
      Step(4, 'They sit an assessment that adapts',
        'Questions are generated against the real chapters of the NCERT/CBSE syllabus for their class, ' +
        'so a Class 10 student is asked Class 10 questions. It asks between 8 and 20 questions and stops ' +
        'as soon as it has enough evidence, so two students on the same subject often sit tests of ' +
        'different lengths. Questions can be read aloud, and taken in Hindi.'),
      Step(5, 'A plan is generated for them',
        'A study plan of 10 to 15 days, built from what the assessment found. Weak chapters get more ' +
        'days and deeper practice; strong chapters become short revision; chapters the assessment could ' +
        'not reach are still covered at standard pace.'),
      Step(6, 'They study, one day at a time',
        'Each day opens as a written lesson, curated teaching videos and a ten-question quiz, generated ' +
        'for that day’s topic. Watch progress is tracked per video, and the day is marked complete only ' +
        'when a video has been watched and the quiz passed at 70 per cent — the platform enforces this, ' +
        'not the student.'),
      Step(7, 'The plan rewrites itself around them',
        'Every quiz answer is filed against a sub-topic. If a student retakes a day’s quiz and a ' +
        'sub-topic is still weak, a new study day aimed at exactly that sub-topic is generated and ' +
        'inserted straight after that day, marked "Added for you". Completed days are never disturbed.'),
      Step(8, 'They keep coming back',
        'The dashboard shows a current and longest study streak, counted from real study activity rather ' +
        'than logins, and a card returning them to the first day they have not finished.')
    ]),

    // ═══ 03 — How the AI works ═══════════════════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '03', accent: ACCENTS.engine, icon: 'spark',
        title: 'How the AI Works for Each Student', badge: '6 areas',
        desc: 'A teacher cannot write forty different study plans a week and rewrite them the next. ' +
              'That is the argument for AI here, and it is worth being precise about where the AI acts.'
      }),
      Card(ACCENTS.engine, {
        icon: 'target', title: 'It writes the assessment, question by question',
        summary: 'Questions are not drawn from a stored bank.',
        points: [
          'Each round is generated against the real chapter list of the student’s class and subject.',
          'Each round responds to how the student has answered so far.',
          'A confident student is swept wide across the syllabus; an ambiguous one is taken deeper into fewer chapters.'
        ]
      }),
      CardPair(ACCENTS.engine, {
        icon: 'map', title: 'It writes the study plan',
        summary: 'Generated from one student’s own results.',
        points: [
          'The course’s real chapter list goes in with the request.',
          'The plan is checked back against that list and regenerated if it left anything out.'
        ]
      }, {
        icon: 'book', title: 'It writes each day and quiz',
        summary: 'Lesson and quiz written for that day’s topic.',
        points: [
          'The day’s ten-question quiz is kept, so returning shows the same quiz.',
          'Practice quizzes, outside the plan, are written new every time.'
        ]
      }),
      CardPair(ACCENTS.engine, {
        icon: 'pen', title: 'It marks written answers',
        summary: 'Free-text answers graded on three criteria.',
        points: [
          'Content, grammar and spelling, each scored out of 100.',
          'Written feedback per criterion, judged against the same pass threshold as the rest of the quiz.'
        ]
      }, {
        icon: 'refresh', title: 'It rewrites the plan when a student is stuck',
        summary: 'Weak sub-topics are acted on, not just reported.',
        points: [
          'A new study day targeted at that sub-topic is generated and slotted in.',
          'The plan a student finishes is rarely the plan they were given.'
        ]
      }),
      Card(ACCENTS.engine, {
        icon: 'cap', title: 'It teaches, and it answers',
        summary: 'The same engine powers the on-page assistant, the long-form Mentor tutor and the study-notes generator.',
        points: [
          'A student stuck on something in a lesson can ask about it in their own words, in either language.'
        ]
      }),
      e(View, { key: 'note', style: s.note, wrap: false },
        e(Text, { style: s.noteTitle }, 'Generated, then checked'),
        e(Text, { style: s.noteText },
          'Generation is not the last step. Before a question reaches a student it is checked and, if ' +
          'it fails, regenerated: questions repeating one already asked, having no single defensible ' +
          'answer, or sitting below the level of the class are rejected.'
        )
      )
    ]),

    // ═══ 04 — The learning core (two pages) ══════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '04', accent: ACCENTS.core, icon: 'layers',
        title: 'The Learning Core', badge: '11 features',
        desc: 'The assessment, the plan, the study day and the loop that keeps adjusting the plan as ' +
              'the student’s results come in.'
      }),
      Card(ACCENTS.core, {
        icon: 'target', title: 'Adaptive diagnostic assessment',
        summary: 'An entry assessment that adjusts as the student answers.',
        points: [
          'Asks between 8 and 20 questions and stops once it is confident, rather than running a fixed-length test.',
          'Every question is generated against a real chapter of the NCERT/CBSE syllabus for that class and subject.',
          'Where it ends without a firm conclusion on a chapter, that chapter is treated as needing teaching rather than assumed fine.'
        ]
      }),
      Card(ACCENTS.core, {
        icon: 'map', title: 'Personalised study roadmap',
        summary: 'The assessment result becomes a generated plan of 10 to 15 study days.',
        points: [
          'Checked against the course’s chapter list, so syllabus breadth is covered — not only what was tested.',
          'Weak chapters earn more days; strong chapters are kept as short revision.',
          'A student can hold a separate plan for each subject they are studying.'
        ]
      }),
      CardPair(ACCENTS.core, {
        icon: 'book', title: 'Daily study modules',
        summary: 'A lesson, videos and a quiz for each day.',
        points: [
          'The written lesson is generated for that specific day’s topic.',
          'Paired with curated teaching videos from established Indian education channels.'
        ]
      }, {
        icon: 'play', title: 'Video completion tracking',
        summary: 'Every video on a day is tracked separately.',
        points: [
          'A video counts as watched at 90 per cent of its length.',
          'Progress is saved as the student watches; skipping back never reduces the furthest point reached.'
        ]
      }),
      Card(ACCENTS.core, {
        icon: 'check', title: 'Per-day quizzes with completion gating',
        summary: 'Each day carries its own ten-question quiz, generated from that day’s topic and lesson.',
        points: [
          'Passing requires 70 per cent, and a day completes only when a video is watched and the quiz passed.',
          'Students may retake a quiz as often as they like.',
          'The last attempt — score, correct answers and explanations — stays available on the day afterwards.'
        ]
      }),
    ]),

    Sheet([
      Contd(ACCENTS.core, 'Section 04 — the learning core, continued'),
      Card(ACCENTS.core, {
        icon: 'chart', title: 'Weak-topic insights',
        summary: 'Quiz answers are recorded against sub-topics, not just against the day.',
        points: [
          'The dashboard aggregates results across the whole plan and surfaces sub-topics scoring below 60 per cent.',
          'Each links back to the day or days that cover it.',
          'This turns "did badly in the quiz" into "does not yet have this specific idea".'
        ]
      }),
      CardPair(ACCENTS.core, {
        icon: 'refresh', title: 'Adaptive remediation',
        summary: 'Weak-topic data feeds back into the plan.',
        points: [
          'An extra study day aimed at the sub-topic is generated and inserted after that day.',
          'Only later days are renumbered — completed work is never rewritten.',
          'The student is told on screen why the day appeared.'
        ]
      }, {
        icon: 'pen', title: 'Practice mode',
        summary: 'Open revision, deliberately separate from the plan.',
        points: [
          'Pick any subject and topic, or tap a flagged weak topic as a shortcut.',
          'Quizzes are written new each time, so repeating a topic does not repeat the questions.',
          'Never marks plan days complete and never alters the weak-topic picture.'
        ]
      }),
      Card(ACCENTS.core, {
        icon: 'notes', title: 'Written and essay questions, AI-graded',
        summary: 'Quizzes are not limited to multiple choice.',
        points: [
          'Written short-answer and essay questions can appear in the assessment, in day quizzes and in practice.',
          'Graded on content, grammar and spelling, with per-criterion feedback and a note on what a strong answer covers.',
          'An answer below the mark is shown as "below threshold", not as wrong.'
        ]
      }),
      CardPair(ACCENTS.core, {
        icon: 'layers', title: 'Multiple subjects and study areas',
        summary: 'Ten subjects across classes from Nursery to Class 12.',
        points: [
          'English splits into Writing, Grammar, Reading or Fusion; Science into Physics, Chemistry, Biology or Combined.',
          'Social Science splits into Economics, Civics, Geography, History or Combined.',
          'Each area is a full course, with its own generated assessment, plan and weak-topic tracking.'
        ]
      }, {
        icon: 'flame', title: 'Streaks and continue where you left off',
        summary: 'Current and longest study streaks on the dashboard.',
        points: [
          'A day counts when the student watches a video to threshold, submits a day quiz or completes a practice session.',
          'Logging in is not enough.',
          'A card links straight to the first unfinished day of the current subject.'
        ]
      })
    ]),

    // ═══ 05 — Language, access and support ═══════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '05', accent: ACCENTS.language, icon: 'globe',
        title: 'Language, Access and Support', badge: '8 features',
        desc: 'The whole platform in English or Hindi, with reading and typing made optional — and ' +
              'three places a student can ask for help in their own words.'
      }),
      CardPair(ACCENTS.language, {
        icon: 'globe', title: 'Hindi on Indian AI models',
        summary: 'Built on Sarvam AI, an Indian provider whose models are designed for Indian languages and accents.',
        points: [
          'Covers translation into Hindi, reading aloud, and understanding a student who speaks.',
          'Hindi and Indian-accented English are handled properly, not as an afterthought.'
        ]
      }, {
        icon: 'layers', title: 'Full bilingual operation',
        summary: 'End to end in English and in Hindi.',
        points: [
          'One switch changes the interface and the content.',
          'Questions, lessons, options, explanations and weak-topic labels are all translated.',
          'Language can change mid-assessment without losing it.'
        ]
      }),
      CardPair(ACCENTS.language, {
        icon: 'speaker', title: 'Read aloud',
        summary: 'For a student who reads slowly.',
        points: [
          'Questions, explanations, lessons and assistant replies.',
          'In Hindi or in English.'
        ]
      }, {
        icon: 'mic', title: 'Voice input',
        summary: 'A student can speak instead of typing.',
        points: [
          'Words appear as they are spoken, in either language.',
          'Dictation follows the language the platform is set to.'
        ]
      }),
      CardPair(ACCENTS.language, {
        icon: 'sliders', title: 'Narration preferences',
        summary: 'Voice settings follow the student, not the device.',
        points: [
          'Narration language, and whether questions are read out automatically.',
          'Saved to the account, so they apply on any device.'
        ]
      }, {
        icon: 'chat', title: 'Eklavya Assistant',
        summary: 'A small AI assistant on every page.',
        points: [
          'For students and for visitors who have not signed in.',
          'Answers questions and offers a button to the right place.'
        ]
      }),
      CardPair(ACCENTS.language, {
        icon: 'cap', title: 'Your Mentor',
        summary: 'A full-page AI tutor for longer teaching.',
        points: [
          'Paragraph-level explanations, kept so an old chat can be reopened.',
          'Never changes a student’s plan, results or streak.'
        ]
      }, {
        icon: 'notes', title: 'AI study notes',
        summary: 'Structured notes generated on any topic.',
        points: [
          'Explanatory points, with definitions, examples and key terms.',
          'Editable, then saved as a branded PDF.'
        ]
      })
    ]),

    // ═══ 06 — Built for Indian classrooms ════════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '06', accent: ACCENTS.fit, icon: 'pin',
        title: 'Built for Indian Classrooms',
        desc: 'The decisions below were made for Indian government-school conditions, not adapted to ' +
              'them afterwards.'
      }),
      Card(ACCENTS.fit, {
        icon: 'globe', title: 'Hindi is not a translation layer bolted on top',
        summary: 'Hindi is a first-class mode of the platform, not a translated menu over English content.',
        points: [
          'Quiz questions, options, explanations, lesson prose, weak-topic labels, board names, form labels and errors all appear in Hindi.',
          'A student in Hindi mode does not meet an English error the moment they mistype.',
          'The translation, narration and voice input behind it come from Sarvam AI, whose models are built for Indian languages and accents.'
        ]
      }),
      Card(ACCENTS.fit, {
        icon: 'book', title: 'The syllabus the student is actually sitting',
        summary: 'Questions are generated against the NCERT/CBSE chapter structure for the student’s class and subject.',
        points: [
          'A stated expected difficulty level for every class from Nursery through Class 12.',
          'Eight named school boards: CBSE, ICSE, Haryana (HBSE), Punjab (PSEB), UP, Maharashtra (MSBSHSE), Bihar (BSEB) and Rajasthan (RBSE).',
          'Plus a free-text option for any other board.'
        ]
      }),
      CardPair(ACCENTS.fit, {
        icon: 'speaker', title: 'For students who read slowly',
        summary: 'Reading speed should not decide what the platform believes about subject knowledge.',
        points: [
          'A student can listen to a question rather than read it.',
          'And speak a query rather than type it, in either language.'
        ]
      }, {
        icon: 'phone', title: 'Modest phones and connections',
        summary: 'Built mobile-first from 360 pixels wide.',
        points: [
          'The sidebar becomes a fixed bottom bar; the subject switcher becomes a swipeable strip.',
          'Videos sit behind a click-to-play image, so the player and its network traffic load only on request.'
        ]
      }),
      Card(ACCENTS.fit, {
        icon: 'check', title: 'Accessible by construction',
        summary: 'Small decisions that matter on a shared school device.',
        points: [
          'Numeric keypads open automatically for age and number fields.',
          'Focus moves to each step’s input as the onboarding flow advances, so the keyboard opens and keyboard users are not left tabbing back.',
          'The Android hardware Back button moves between onboarding steps rather than throwing the student out of the flow.',
          'Where a student has asked their device to reduce motion, animations cross-fade instead of sliding.'
        ]
      })
    ]),

    // ═══ 07 — Parents, administrators and accounts ═══════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '07', accent: ACCENTS.oversight, icon: 'users',
        title: 'Parents, Administrators and Accounts', badge: '5 features',
        desc: 'Oversight is read-only by construction. Neither a parent nor an administrator can change ' +
              'a student’s work, or be given that power by a setting.'
      }),
      Card(ACCENTS.oversight, {
        icon: 'users', title: 'Parent accounts',
        summary: 'A student can create a parent login from their own settings.',
        points: [
          'The platform generates a memorable one-time password, shows it once, and requires the parent to set their own on first sign-in.',
          'The parent sees their child’s plan progress, study streak and weak topics — and nothing else.',
          'A parent session cannot complete a day, take a quiz or change the student’s details, and is bound to exactly one child.'
        ]
      }),
      CardPair(ACCENTS.oversight, {
        icon: 'chart', title: 'Administrator console',
        summary: 'Optional, read-only departmental oversight.',
        points: [
          'Which students have a parent account linked.',
          'Per student, exactly what a parent can see: plans, weak topics and activity.',
          'No editing surface at all, and the session is not tied to any user account, so it cannot act as a student.'
        ]
      }, {
        icon: 'lock', title: 'Three-factor administrator sign-in',
        summary: 'Email, password and a separate security code, together.',
        points: [
          'Checked as a single unit, with one generic failure message so no factor can be probed, and its own stricter attempt limit.',
          'The console is switched off entirely unless the deployment configures it.'
        ]
      }),
      CardPair(ACCENTS.oversight, {
        icon: 'shield', title: 'Secure accounts and roles',
        summary: 'Every account is a student, a parent or an administrator.',
        points: [
          'The server checks the role on every request, rather than hiding buttons in the interface.',
          'Passwords are stored only as hashes, and need eight characters with a capital, a number and a symbol.',
          'Repeated failed sign-ins from one address are rate-limited; one mistyped password is not penalised.'
        ]
      }, {
        icon: 'notes', title: 'Student onboarding profile',
        summary: 'A guided, animated first-run flow, one question per screen.',
        points: [
          'Collects age, board, father’s name, school and city or village.',
          'Optional phone, location and identity fields sit in a final, clearly separated step with a prominent Skip.',
          'Fully bilingual down to the error messages, and its saved draft excludes the sensitive fields.'
        ]
      })
    ]),

    // ═══ 08 — Privacy ════════════════════════════════════════════════════════
    Sheet([
      e(Banner, {
        key: 'b', n: '08', accent: ACCENTS.privacy, icon: 'shield',
        title: 'Privacy and Data Protection',
        desc: 'Eklavya is built so that sensitive student data cannot be misused, rather than merely so ' +
              'that policy forbids misusing it. A rule can be waived; a capability that does not exist cannot be.'
      }),
      e(View, { key: 'dark', style: s.darkPanel },
        e(Text, { style: s.darkTitle }, 'Privacy by design'),
        e(Text, { style: s.darkLede },
          'Where a deployment chooses to collect a government identity number, these are the guarantees ' +
          'the system enforces on itself.'
        ),
        DarkItem('Encrypted at rest, immediately',
          'The number is encrypted the moment the request arrives, and the readable value is released before any record is touched.'),
        DarkItem('The platform cannot read it back',
          'There is deliberately no decryption function anywhere in the running system — not a restricted one, not an administrator-only one. The capability is absent, so no future screen can be one line away from exposing it.'),
        DarkItem('Displayed masked, to the student only',
          'What can be shown is the last four digits. Parent and administrator sessions do not receive even the masked value — the fields are left out of their data entirely, rather than hidden by the interface.'),
        DarkItem('Opt-in per deployment',
          'Collection is off unless a deployment switches it on. If switched on without a valid encryption key, the server refuses to start at all.'),
        DarkItem('Explicit consent, recorded with a timestamp',
          'The consent checkbox starts unticked; no number is accepted without it. Consent is checked per submission, so replacing a number is a fresh disclosure — the box reappears unticked and a new timestamp is written.'),
        DarkItem('Consent can be withdrawn',
          'A student can delete the number from their own settings at any time. The stored value, the last four digits and the consent timestamp are removed together, permanently.'),
        DarkItem('Location is three text fields, never coordinates',
          'Only village, city and state are stored. Device coordinates are used momentarily to look up the place name and then discarded. No record has a coordinate field for them to be written to.'),
        DarkItem('Never written to the logs',
          'Sensitive values do not appear in logs, error messages or analytics. Validation failures return short codes rather than sentences, so a rejected value cannot be echoed back inside an error message.')
      ),
      e(View, { key: 'note', style: s.note, wrap: false },
        e(Text, { style: s.noteTitle }, 'A point of honesty'),
        e(Text, { style: s.noteText },
          'Identity numbers are checked against the standard checksum before storage, which keeps typos ' +
          'and junk out of the records. That is a format check, not identity verification, and Eklavya ' +
          'does not present it as one.'
        )
      )
    ]),

    // ═══ Closing — full bleed, mirroring the cover ═══════════════════════════
    e(Page, { size: 'A4', style: s.bleed },
      e(View, { style: s.bleedInner },
        e(View, { style: s.brandRow },
          e(View, { style: s.brandTile }, e(Logo, { size: 32 })),
          e(View, null,
            e(Text, { style: s.brandName }, 'EKLAVYA'),
            e(Text, { style: s.brandTag }, 'Ek Shikshak, Har Vidhyarthi')
          )
        ),

        e(View, { style: { marginTop: 88 } },
          e(Text, { style: s.coverEyebrow }, 'IN SUMMARY'),
          e(Text, { style: s.coverHead }, 'A plan for one\nstudent, rewritten\nas they change.'),
          e(View, { style: s.coverRule }),
          e(Text, { style: s.coverSub },
            'Eklavya gives every student the thing a classroom cannot give forty of at once. Everything ' +
            'in this document is built and working today; nothing here is a plan or a projection.'
          )
        ),

        e(View, { style: { marginTop: 'auto' } },
          e(View, { style: s.tileRow },
            e(View, { style: s.tile },
              e(Text, { style: s.tileLabel }, 'FOR THE STUDENT'),
              e(Text, { style: s.tileText },
                'An assessment that adapts, a generated 10 to 15 day plan, and daily lessons, videos ' +
                'and quizzes that must actually be completed.')),
            e(View, { style: s.tileGap }),
            e(View, { style: s.tile },
              e(Text, { style: s.tileLabel }, 'FOR THE PARENT'),
              e(Text, { style: s.tileText },
                'A login of their own showing one child’s progress, streak and weak topics — and that ' +
                'can change nothing.')),
            e(View, { style: s.tileGap }),
            e(View, { style: s.tile },
              e(Text, { style: s.tileLabel }, 'FOR THE DEPARTMENT'),
              e(Text, { style: s.tileText },
                'A read-only console showing parent linkage and per-student progress, behind a ' +
                'three-factor sign-in.'))
          ),
          e(Text, { style: { fontSize: tokens.size.small, color: tokens.alpha.w60, marginTop: 20, letterSpacing: 0.8 } },
            'EK SHIKSHAK, HAR VIDHYARTHI  ·  ONE TEACHER, FOR EVERY STUDENT')
        )
      )
    )
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────
export { FeatureOverview, OUT_FILE };

export async function generate() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await renderToFile(FeatureOverview(), OUT_FILE);
  const { size } = fs.statSync(OUT_FILE);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_FILE)} (${(size / 1024).toFixed(1)} KB)`);
}

// Only write when run directly, so the document can also be imported for checks.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generate();
}
