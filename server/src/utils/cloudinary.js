import { v2 as cloudinary } from 'cloudinary';

// Phase 7.5: server-side Cloudinary integration for profile photos. The API
// secret lives ONLY here (never sent to the client — no unsigned upload preset).
// Configured from env; if the env vars are absent the feature is treated as
// disabled and the route returns 503 rather than crashing.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;


// Regional endpoint. An account provisioned in Asia-Pacific or the EU serves the
// API from `api-ap.cloudinary.com` / `api-eu.cloudinary.com` rather than the default
// host, and a region mismatch surfaces as a PERMISSION error rather than a clean
// "wrong host" — indistinguishable from a bad key without the error body. Set
// explicitly from the console rather than relying on the default.
//   CLOUDINARY_UPLOAD_PREFIX=https://api-ap.cloudinary.com
const UPLOAD_PREFIX = process.env.CLOUDINARY_UPLOAD_PREFIX;

export const cloudinaryConfigured = !!(CLOUD_NAME && API_KEY && API_SECRET);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
    ...(UPLOAD_PREFIX ? { upload_prefix: UPLOAD_PREFIX } : {})
  });
  console.log(`Cloudinary: configured (cloud "${CLOUD_NAME}"${UPLOAD_PREFIX ? `, region host ${UPLOAD_PREFIX}` : ', default host'})`);
} else {
  console.log('Cloudinary: NOT configured — image upload returns 503, text editing unaffected');
}

const PROFILE_FOLDER = 'eklavya/profile-photos';

// Deterministic per-user public_id → a re-upload OVERWRITES the same asset in
// place, so old photos are never left orphaned (no separate delete needed).
const publicIdFor = (userId) => `${PROFILE_FOLDER}/${userId}`;

// Upload a validated image buffer as the user's avatar. The incoming
// transformation resizes to a 512×512 center-cropped square, applied BEFORE
// storing — deterministic (no AI add-on needed) and it strips EXIF/other
// metadata (important since users may be minors). Returns the delivered
// secure_url (versioned, so the client always fetches the fresh image after a
// replace).
export async function uploadProfilePhoto(userId, buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: publicIdFor(userId),
        overwrite: true,
        invalidate: true, // purge CDN cache of the previous version
        resource_type: 'image',
        format: 'jpg', // normalize output format (also strips EXIF via re-encode)
        // JPEG has no alpha channel, so a transparent PNG/WebP avatar gets FLATTENED
        // onto a background. The default is undocumented and I could not verify it by
        // decoding the result, so it is set explicitly rather than depended on: a
        // student uploading a transparent avatar must not discover a black square
        // against this app's light surfaces (#FCFBF7 / #fff).
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'center', background: 'white' }]
      },
      (error, result) => {
        if (error) {
          // Same instrumentation as the notes path — profile photos use the same
          // Upload API, so they fail the same way and were equally undiagnosable.
          console.error(
            'Cloudinary profile-photo upload failed:',
            JSON.stringify({ http_code: error.http_code, name: error.name, message: error.message })
          );
          return reject(error);
        }
        resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// Remove the user's avatar asset (used on explicit "remove photo").
export async function deleteProfilePhoto(userId) {
  await cloudinary.uploader.destroy(publicIdFor(userId), { resource_type: 'image', invalidate: true });
}

// Workstream C — image upload for a "My Notes" page.
//
// Distinct from a profile photo: notes images are ADDITIVE (a page can hold many, up
// to MAX_IMAGES_PER_PAGE), so the public id must be unique per upload rather than
// deterministic-per-user — a deterministic id would make each paste overwrite the
// previous one. Scoped under the student and the note so assets are attributable.
//
// Resized to 1600px on the LONG edge (`crop: 'limit'` only shrinks, never upscales)
// and re-encoded, which strips EXIF — including any GPS tags a phone camera wrote
// into a photo of a textbook page. That matters here for the same reason the
// reverse-geocode path discards coordinates.
// ── Workstream I: past-paper import assets ──────────────────────────────────
//
// Three things get stored per imported paper, and they are deliberately separate
// assets rather than one:
//
//   1. the ORIGINAL PDF          — never overwritten, so a bad re-parse is recoverable
//   2. one RENDERED PAGE IMAGE per page — the raster the vision parse saw, and the
//      surface every figure is cropped out of
//   3. nothing per figure         — see pyqDiagramUrl below; crops are URL transforms
//
const PYQ_FOLDER = 'eklavya/pyq';

/**
 * Store the uploaded PDF itself. `resource_type: 'raw'` because it is not an image —
 * uploading a PDF as `image` lets Cloudinary rasterise and page-split it, which is a
 * different asset with different semantics and is not what "keep the original" means.
 *
 * Deterministic public id per paper: a re-upload of the same paper replaces it rather
 * than accumulating orphans, matching the profile-photo convention.
 */
export async function uploadPastPaperPdf(buffer, paperId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `${PYQ_FOLDER}/${paperId}/source`,
        overwrite: true,
        invalidate: true,
        resource_type: 'raw'
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary past-paper PDF upload failed:',
            JSON.stringify({ http_code: error.http_code, name: error.name, message: error.message }));
          return reject(error);
        }
        resolve({ url: result?.secure_url || null, publicId: result?.public_id || '' });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Store one RENDERED PAGE as an image. Uploaded at full rendered resolution with no
 * resize transformation: this is the surface figures are cropped from, and shrinking
 * it first would throw away exactly the detail a geometry or circuit figure needs.
 *
 * `quality: auto:best` rather than auto:good for the same reason — a compression
 * artefact in a printed diagram's hatching is not recoverable later.
 */
export async function uploadPyqPageImage(buffer, paperId, pageNumber) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `${PYQ_FOLDER}/${paperId}/page-${pageNumber}`,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        format: 'png',                       // lossless; re-encode also strips metadata
        transformation: [{ quality: 'auto:best' }]
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary PYQ page-image upload failed:',
            JSON.stringify({ http_code: error.http_code, name: error.name, message: error.message }));
          return reject(error);
        }
        resolve({ url: result?.secure_url || null, publicId: result?.public_id || '' });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Store ONE FIGURE, extracted from the PDF's own embedded image objects.
 *
 * This replaced the crop-transform approach below, and the replacement is strictly
 * better on every axis:
 *   • The asset IS the figure — exact bounds from the PDF structure, no model-guessed
 *     box, nothing to re-crop, and no crop editor to build.
 *   • Original resolution (measured up to 814x350 against ~230x240 for the same
 *     figure cropped from a 150 DPI page render), so screen-density concerns vanish.
 *   • NO CROP-URL EXPOSURE. There are no crop parameters to strip, so the "anyone can
 *     recover the full page" trade-off the transform approach carried is simply gone
 *     rather than accepted.
 *
 * No resize transformation: this is already exactly the figure, and shrinking it
 * would throw away the detail a circuit or ray diagram needs. `quality: auto:best`
 * for the same reason — a compression artefact in printed hatching is not recoverable.
 */
export async function uploadPyqFigure(buffer, paperId, figureIndex) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `${PYQ_FOLDER}/${paperId}/figure-${figureIndex}`,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
        format: 'png',
        transformation: [{ quality: 'auto:best' }]
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary PYQ figure upload failed:',
            JSON.stringify({ http_code: error.http_code, name: error.name, message: error.message }));
          return reject(error);
        }
        resolve({ url: result?.secure_url || null, publicId: result?.public_id || '' });
      }
    );
    stream.end(buffer);
  });
}

/**
 * Build the delivery URL for a figure as a CROP TRANSFORM over the stored page image.
 *
 * SUPERSEDED by uploadPyqFigure above — kept only for admin-supplied replacements
 * that arrive as a region of a page image. New imports do not use it.
 *
 * WHY A TRANSFORM AND NOT A CROPPED UPLOAD: I3 requires the admin to be able to
 * re-crop, because automatic region detection will get some wrong. With a transform,
 * a re-crop is four numbers changing on a document — no re-upload, no re-processing,
 * and the full page is always still there to crop from again. With a cropped upload,
 * the page would have to be kept anyway to make re-cropping possible at all, so the
 * separate asset buys nothing and costs a round-trip per correction.
 *
 * ACCEPTED TRADE-OFF, recorded deliberately: anyone who strips the crop parameters
 * from this URL gets the whole rendered page. That is fine HERE and only here — these
 * are published past papers, documents the boards themselves put in public. Nothing
 * is disclosed that was not already public.
 *
 * DO NOT REUSE THIS PATTERN FOR ANYTHING PRIVATE. A crop is a presentation
 * instruction, not an access control, and treating it as one would leak the
 * surrounding page. Anything genuinely private needs a separately-uploaded derived
 * asset (or a signed URL), not a transform.
 */
export function pyqDiagramUrl(pagePublicId, crop) {
  // `cloudinary.url()` THROWS ("Must supply cloud_name") when the SDK is
  // unconfigured, rather than returning something falsy. Every other export here
  // degrades to a 503 at the route level, so this one throwing was a latent crash in
  // any environment without Cloudinary env vars — found when a CI invariant drove
  // the import mapping and the whole run died on it. Returning '' matches the "no
  // figure" case the callers already handle.
  if (!cloudinaryConfigured) return '';
  if (!pagePublicId || !crop) return '';
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every((n) => Number.isFinite(n)) || width <= 0 || height <= 0) return '';
  return cloudinary.url(pagePublicId, {
    secure: true,
    type: 'upload',
    transformation: [{
      crop: 'crop',
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: Math.round(width),
      height: Math.round(height)
    }]
  });
}

/** Remove every stored asset for a paper (source PDF + all page images). */
export async function deletePyqAssets(paperId) {
  await cloudinary.api.delete_resources_by_prefix(`${PYQ_FOLDER}/${paperId}/`, { resource_type: 'image' })
    .catch((e) => console.warn('PYQ page-image cleanup failed:', e.message));
  await cloudinary.api.delete_resources_by_prefix(`${PYQ_FOLDER}/${paperId}/`, { resource_type: 'raw' })
    .catch((e) => console.warn('PYQ source-PDF cleanup failed:', e.message));
}

export async function uploadNoteImage(buffer, userId, noteId) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        public_id: `eklavya/notes/${userId}/${noteId}/${unique}`,
        overwrite: false,
        resource_type: 'image',
        transformation: [
          { width: 1600, height: 1600, crop: 'limit' },
          { quality: 'auto:good' }
        ]
      },
      (error, result) => {
        if (error) {
          // Log the provider's OWN message. Cloudinary distinguishes wrong product
          // type from a restricted key from a region mismatch, and swallowing it into
          // a generic failure is why diagnosing the 403 in this environment was
          // guesswork. Never logs the image bytes — only the provider's reason.
          console.error(
            'Cloudinary note-image upload failed:',
            JSON.stringify({ http_code: error.http_code, name: error.name, message: error.message })
          );
          return reject(error);
        }
        resolve(result?.secure_url || null);
      }
    );
    stream.end(buffer);
  });
}
