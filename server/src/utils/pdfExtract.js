// Workstream I — PDF text extraction + page rasterisation for the past-paper import.
//
// Two outputs per page, and the parse needs BOTH for different things:
//
//   • TEXT  — used for EXACT WORDING. Vision transcription drifts: it paraphrases,
//     silently corrects what it reads as a typo, and normalises notation. For a past
//     paper the wording is the artefact, so the words come from the text layer.
//   • IMAGE — used for STRUCTURE. Exam PDFs are multi-column, put marks in the
//     margin, and interleave figures with text. A text layer flattens all of that
//     into one stream, which is why extraction "frequently mangles or reorders"
//     question numbers: reading order is a layout property and the text layer has
//     already thrown the layout away. The raster still has it.
//
// This module does extraction only. It makes no model calls and knows nothing about
// questions or sections — utils/parsePastPaper.js owns that.
//
// mupdf (WASM) rather than a system binary: it does text, rasterisation and geometry
// in one npm dependency, so there is nothing for a deployment host to apt-install and
// nothing to fail at runtime on a box that was provisioned without it.

import * as mupdf from 'mupdf';

// 150 DPI. The vision model needs enough resolution to resolve a subscript, a
// degree sign and the hatching in a printed figure; it does not need print
// resolution, and every extra DPI is base64 bytes in a request body that already
// carries a whole page. 150 renders a 595×842pt A4 page to roughly 1240×1754,
// which is comfortably inside gpt-4o's detail budget.
const RENDER_DPI = 150;
const PDF_POINTS_PER_INCH = 72;
export const RENDER_SCALE = RENDER_DPI / PDF_POINTS_PER_INCH;

// A board paper is 10-40 pages. 80 is a runaway backstop — a mis-uploaded 900-page
// textbook would otherwise become 900 vision calls before anyone noticed.
export const MAX_PDF_PAGES = 80;

/**
 * Is this actually a PDF? Magic bytes, not the filename and not the client's
 * Content-Type — the same reasoning as utils/imageSniff.js, which exists because a
 * declared type is a claim by the uploader.
 */
export function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Extract text + a rendered PNG for every page.
 *
 * Returns { pageCount, pages: [{ pageNumber, text, png, width, height }] } where
 * width/height are the RENDERED PIXEL dimensions — the coordinate space every
 * figure bounding box is expressed in, so the crop that reaches Cloudinary and the
 * box the model returned are measured against the same thing. Mixing rendered
 * pixels with PDF points is the obvious way to get crops that are subtly offset on
 * every page, so the units are fixed here and never reinterpreted downstream.
 *
 * Throws with a NAMED stage on failure, matching the drop-stage instrumentation the
 * diagram pipeline uses — a failed import must say which stage died.
 */
export async function extractPdfPages(buffer, { maxPages = MAX_PDF_PAGES } = {}) {
  if (!isPdfBuffer(buffer)) {
    throw new Error('PDF_INVALID_MAGIC_BYTES');
  }

  let doc;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch (err) {
    // Encrypted, truncated, or not really a PDF past the header.
    throw new Error(`PDF_OPEN_FAILED: ${err.message}`);
  }

  const total = doc.countPages();
  if (!total) throw new Error('PDF_NO_PAGES');

  const pageCount = Math.min(total, maxPages);
  const pages = [];

  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.loadPage(i);

    // ── Text ────────────────────────────────────────────────────────────────
    let text = '';
    try {
      // preserve-spans keeps column runs as separate spans instead of merging them
      // into one line, which is what turns a two-column page into interleaved
      // nonsense. It does not fix reading order — that is what the image is for —
      // but it stops the text layer from actively inventing adjacency.
      const stext = page.toStructuredText('preserve-spans');
      text = stext.asText();
      stext.destroy?.();
    } catch (err) {
      // A page whose text layer is broken (a pure scan, for instance) is NOT fatal:
      // the vision pass can still read it. Losing exact wording is a quality
      // degradation to flag, not a reason to abandon a whole paper.
      console.warn(`PDF text extraction failed on page ${i + 1}: ${err.message}`);
      text = '';
    }

    // ── Raster ──────────────────────────────────────────────────────────────
    let png;
    let width = 0;
    let height = 0;
    try {
      const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
      // No alpha: a transparent background renders as black in some encoders, and a
      // black page is both useless to the model and expensive to debug.
      const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false);
      width = pixmap.getWidth();
      height = pixmap.getHeight();
      png = Buffer.from(pixmap.asPNG());
      pixmap.destroy?.();
    } catch (err) {
      throw new Error(`PDF_RENDER_FAILED_PAGE_${i + 1}: ${err.message}`);
    }

    page.destroy?.();
    pages.push({ pageNumber: i + 1, text: text.trim(), png, width, height });
  }

  doc.destroy?.();

  return { pageCount, totalPages: total, truncated: total > pageCount, pages };
}

/** A page image as a data URI, the shape OpenAI's vision content part expects. */
export function pageImageDataUri(png) {
  return `data:image/png;base64,${png.toString('base64')}`;
}

// ── Embedded figure extraction ──────────────────────────────────────────────
//
// Figures in board-paper PDFs are EMBEDDED IMAGE OBJECTS placed by the authoring
// tool, not ink on a rendered page. Pulling them out directly beats cropping a
// rendered page on every axis that matters:
//
//   • EXACT BOUNDS, from the PDF's own structure. No model-guessed pixel box, so no
//     wrong crops to correct and no crop editor to build.
//   • ORIGINAL RESOLUTION. Measured on the CBSE Class 10 Science SQP: the embedded
//     assets run up to 814x350 and 794x641, against ~230x240 for the same figure
//     cropped from a 150 DPI page render. The whole "is the render DPI high enough
//     for a phone screen" question stops existing.
//   • NO CROP-URL TRADE-OFF. The figure is its own uploaded asset, so there are no
//     crop parameters to strip and no way to walk back up to the full page.
//
// Measured on that paper: 13 embedded images across 15 pages, every sampled one a
// genuine question figure (digestive system, atomic shells, ray optics, circuits).
//
// THE TRAP, and the reason this is more than three lines of code: `image.toPixmap()`
// does NOT apply a PDF soft mask. An image whose transparency lives in a separate
// /SMask comes back as its raw RGB — which for these figures is a BLACK background,
// because the visible artwork is white-on-transparent. Rendering that gives a black
// rectangle with barely-visible strokes. `getMask()` returns the mask as its own
// image and it has to be composited manually. One of the two figures on page 11 has
// a mask and one does not, so a pipeline that ignores masks looks like it works.
export function extractEmbeddedFigures(buffer) {
  if (!isPdfBuffer(buffer)) throw new Error('PDF_INVALID_MAGIC_BYTES');

  let doc;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch (err) {
    throw new Error(`PDF_OPEN_FAILED: ${err.message}`);
  }

  const figures = [];
  const pageCount = Math.min(doc.countPages(), MAX_PDF_PAGES);

  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.loadPage(i);
    let stext;
    try {
      stext = page.toStructuredText('preserve-images');
    } catch (err) {
      console.warn(`Embedded-figure extraction failed on page ${i + 1}: ${err.message}`);
      page.destroy?.();
      continue;
    }

    let indexOnPage = 0;
    stext.walk({
      onImageBlock(bbox, transform, image) {
        indexOnPage += 1;
        try {
          const png = flattenImageOntoWhite(image);
          if (!png) return;
          figures.push({
            pageNumber: i + 1,
            indexOnPage,
            // PDF-space bbox [x0,y0,x1,y1]. Kept for ORDERING and for telling the
            // model where on the page each figure sits — never for cropping.
            bbox: Array.from(bbox).map((v) => Math.round(v)),
            width: image.getWidth(),
            height: image.getHeight(),
            png
          });
        } catch (err) {
          console.warn(`Figure ${indexOnPage} on page ${i + 1} could not be decoded: ${err.message}`);
        }
      }
    });

    stext.destroy?.();
    page.destroy?.();
  }

  // Reading order: down the page, then left to right. Board papers are effectively
  // single-column for figures, so this matches how a reader meets them.
  figures.sort((a, b) => a.pageNumber - b.pageNumber || a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  figures.forEach((f, n) => { f.figureIndex = n + 1; });

  doc.destroy?.();
  return figures;
}

/**
 * Decode one embedded image to PNG on a WHITE background, applying its soft mask.
 *
 * Composited by hand rather than through a DrawDevice: drawing the image into a
 * cleared pixmap was tried first and produced a black background AND a vertical
 * flip, because fillImage's matrix maps the unit square with an inverted y-axis and
 * it does not apply the /SMask either. Reading the pixels and compositing is
 * explicit, verifiable, and has no orientation to get wrong.
 */
function flattenImageOntoWhite(image) {
  const src = image.toPixmap();
  const w = src.getWidth();
  const h = src.getHeight();
  const nc = src.getNumberOfComponents();
  const hasAlpha = !!src.getAlpha();

  // ── COPY THE PIXELS OUT OF WASM MEMORY IMMEDIATELY ──────────────────────
  // `getPixels()` returns a VIEW into the mupdf WASM heap, not a copy. Allocating
  // anything else afterwards — here, the destination Pixmap — can grow that heap,
  // and growing it DETACHES every existing view. The reads then silently yield
  // zeros, and zeros composite to a solid black rectangle.
  //
  // This is why it must be a copy and not just careful ordering: whether the heap
  // grows depends on the image's size and on what has already been allocated, so the
  // bug is intermittent AND size-dependent. Measured on the CBSE Science paper: two
  // figures with identical structure (RGBA + soft mask), one on page 11 and one on
  // page 13 — the page 11 figure came out perfect and the page 13 figure came out
  // solid black, in the same run. A version of this that "works" proves nothing.
  const sp = Uint8Array.from(src.getPixels());

  // A separate soft mask carries the real transparency. Greyscale, same dimensions.
  let mpx = null;
  let mnc = 0;
  const maskImage = image.getMask?.();
  if (maskImage) {
    const mp = maskImage.toPixmap();
    if (mp.getWidth() === w && mp.getHeight() === h) {
      mpx = Uint8Array.from(mp.getPixels());
      mnc = mp.getNumberOfComponents();
    }
    mp.destroy?.();
  }
  src.destroy?.();

  // Allocated AFTER both sources are safely copied out.
  const dst = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const dp = dst.getPixels();
  const colourComponents = Math.min(3, hasAlpha ? nc - 1 : nc);

  // Uniformity is tracked DURING the composite, not measured afterwards.
  //
  // The obvious version — build the PNG, then scan `dp` to check the result is not a
  // blank rectangle — does not work, and fails in a way that looks like a content
  // problem rather than a memory one: `asPNG()` allocates inside the WASM heap,
  // which detaches `dp`, so the scan reads zeros and declares every figure blank.
  // That is the SAME detachment hazard as the source pixels above, biting a second
  // time on the way out. The rule for this file: treat any mupdf call as capable of
  // invalidating every view obtained before it.
  let uniform = true;
  let firstR = -1; let firstG = -1; let firstB = -1;

  for (let i = 0, j = 0, k = 0, m = 0; i < w * h; i += 1, j += nc, k += 3, m += mnc) {
    // Coverage from the soft mask, else the image's own alpha, else opaque.
    const a = mpx ? mpx[m] / 255 : (hasAlpha ? sp[j + nc - 1] / 255 : 1);
    for (let c = 0; c < 3; c += 1) {
      // Greyscale sources have one colour component to spread across RGB.
      const v = sp[j + (colourComponents === 1 ? 0 : c)];
      dp[k + c] = Math.round(v * a + 255 * (1 - a));
    }
    if (i === 0) { firstR = dp[0]; firstG = dp[1]; firstB = dp[2]; }
    else if (uniform && (dp[k] !== firstR || dp[k + 1] !== firstG || dp[k + 2] !== firstB)) {
      uniform = false;
    }
  }

  // A figure that composited to a single flat colour carries no visible content.
  // Returned as null rather than shipped: a blank rectangle presented as a
  // question's figure is worse than no figure, because the I3 rule then holds the
  // question back from publication instead of publishing something meaningless.
  if (uniform) return null;

  return Buffer.from(dst.asPNG());
}
