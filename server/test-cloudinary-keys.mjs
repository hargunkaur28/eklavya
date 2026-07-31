// Direct Upload API probe — bypasses the SDK entirely and signs the request by hand,
// so a failure here is the account/credentials, not our wrapper.
import 'dotenv/config';
import crypto from 'crypto';

const cloud  = process.env.CLOUDINARY_CLOUD_NAME;
const key    = process.env.CLOUDINARY_API_KEY;
const secret = process.env.CLOUDINARY_API_SECRET;

// Length checks catch trailing whitespace from a paste — the most common cause of a
// "valid-looking" credential that fails signing.
console.log('cloud_name :', JSON.stringify(cloud));
console.log('api_key len:', key?.length, key ? `(starts ${key.slice(0, 3)}…, ends …${key.slice(-2)})` : '');
console.log('secret len :', secret?.length, '(compare to console)');
console.log('whitespace :', [cloud, key, secret].some((v) => v && v !== v.trim()) ? '*** TRAILING/LEADING WHITESPACE PRESENT ***' : 'none');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const timestamp = Math.floor(Date.now() / 1000);
const signature = crypto
  .createHash('sha1')
  .update(`timestamp=${timestamp}${secret}`)
  .digest('hex');

const form = new FormData();
form.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
form.append('api_key', key);
form.append('timestamp', String(timestamp));
form.append('signature', signature);

const res = await fetch(
  `https://api.cloudinary.com/v1_1/${cloud}/image/upload`,
  { method: 'POST', body: form }
);

console.log('\nHTTP', res.status);
console.log(await res.text());
