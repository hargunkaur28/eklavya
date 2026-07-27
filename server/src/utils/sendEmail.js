/**
 * Shared Brevo Email Sending Utility
 * Uses Brevo's Transactional Email REST API.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

export async function sendEmail({ to, subject, htmlContent }) {
  const apiKey = process.env.BREVO_API_KEY;
  const fromEmail = process.env.MAIL_FROM_EMAIL || 'noreply@eklavya.test';
  const fromName = process.env.MAIL_FROM_NAME || 'Project Eklavya';

  if (!apiKey || apiKey === 'your_brevo_api_key_here') {
    console.warn(`[Brevo Email] BREVO_API_KEY not configured. Email to ${to} ("${subject}") simulated in console log.`);
    return { success: false, simulated: true, error: 'BREVO_API_KEY not set in .env' };
  }

  const payload = {
    sender: { name: fromName, email: fromEmail },
    to: [{ email: to }],
    subject,
    htmlContent
  };

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Brevo Email Error ${response.status}]:`, errText);
      return { success: false, error: `Brevo API returned HTTP ${response.status}: ${errText}` };
    }

    const data = await response.json();
    console.log(`[Brevo Email Sent ✅] MessageId: ${data.messageId || 'ok'} to ${to}`);
    return { success: true, messageId: data.messageId };
  } catch (err) {
    console.error(`[Brevo Email Exception]:`, err.message);
    return { success: false, error: err.message };
  }
}
