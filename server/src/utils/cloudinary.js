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
