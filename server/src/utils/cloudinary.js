import { v2 as cloudinary } from 'cloudinary';

// Phase 7.5: server-side Cloudinary integration for profile photos. The API
// secret lives ONLY here (never sent to the client — no unsigned upload preset).
// Configured from env; if the env vars are absent the feature is treated as
// disabled and the route returns 503 rather than crashing.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

export const cloudinaryConfigured = !!(CLOUD_NAME && API_KEY && API_SECRET);

if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true
  });
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
        format: 'jpg', // normalize output format
        transformation: [{ width: 512, height: 512, crop: 'fill', gravity: 'center' }]
      },
      (error, result) => {
        if (error) return reject(error);
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
