// Phase 7.5: detect an image's REAL type from its leading bytes (magic numbers),
// not the file extension or the browser-reported Content-Type — both of which a
// client can spoof (a renamed .exe with a .jpg name would pass those but fails
// here). Returns 'image/jpeg' | 'image/png' | 'image/webp' | null.
//
// Only these three are allowed for avatars. A null return = reject.
export function sniffImageMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: "RIFF" .... "WEBP"  (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
