/**
 * Transactional Email Templates for Project Eklavya
 * All templates strictly branded as "Project Eklavya".
 */

export function buildFailedLoginAlertEmail({ account, role = 'Super Admin', attemptCount, ipAddress, timestamp, browser }) {
  const formattedTime = timestamp || new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'full',
    timeStyle: 'medium'
  }) + ' (IST)';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Security Alert — Project Eklavya</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 20px; color: #1e293b; }
    .email-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: #0f172a; padding: 24px; text-align: center; }
    .brand { color: #f59e0b; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; text-decoration: none; display: inline-flex; align-items: center; gap: 8px; }
    .badge { display: inline-block; background-color: #fef2f2; color: #dc2626; border: 1px solid #fecaca; font-weight: 600; font-size: 13px; padding: 6px 14px; border-radius: 20px; margin-top: 16px; }
    .content { padding: 32px 28px; }
    .alert-title { font-size: 20px; font-weight: 700; color: #991b1b; margin: 0 0 12px 0; }
    .alert-desc { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
    .details-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; background: #f8fafc; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    .details-table td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #e2e8f0; }
    .details-table tr:last-child td { border-bottom: none; }
    .label-col { font-weight: 600; color: #334155; width: 35%; background-color: #f1f5f9; }
    .value-col { color: #0f172a; font-weight: 500; font-family: monospace, monospace; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="email-card">
    <div class="header">
      <div class="brand">🎓 Project Eklavya</div>
    </div>
    <div class="content">
      <div style="text-align: center; margin-bottom: 16px;">
        <span class="badge">⚠️ FAILED LOGIN ATTEMPT ALERT</span>
      </div>
      <h2 class="alert-title" style="text-align: center;">Security Notice</h2>
      <p class="alert-desc">
        There has been a failed login attempt on your <strong>Project Eklavya</strong> portal. Details of the request are logged below:
      </p>

      <table class="details-table">
        <tr>
          <td class="label-col">Account</td>
          <td class="value-col">${account}</td>
        </tr>
        <tr>
          <td class="label-col">Role</td>
          <td class="value-col">${role}</td>
        </tr>
        <tr>
          <td class="label-col">Attempt Count</td>
          <td class="value-col">${attemptCount}</td>
        </tr>
        <tr>
          <td class="label-col">IP Address</td>
          <td class="value-col">${ipAddress || '127.0.0.1'}</td>
        </tr>
        <tr>
          <td class="label-col">Time (IST)</td>
          <td class="value-col">${formattedTime}</td>
        </tr>
        <tr>
          <td class="label-col">Browser</td>
          <td class="value-col">${browser || 'Unknown Browser'}</td>
        </tr>
      </table>

      <p class="alert-desc" style="font-size: 13px; color: #64748b;">
        If this attempt was made by you, please check your password or security code. If you did not initiate this request, we strongly advise updating your credentials immediately.
      </p>
    </div>
    <div class="footer">
      This is an automated security notification from Project Eklavya Security Systems.
    </div>
  </div>
</body>
</html>
  `;
}

export function buildOtpEmail({ studentName, otp, expiryMinutes = 10 }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP — Project Eklavya</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 20px; color: #1e293b; }
    .email-card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: #0f172a; padding: 24px; text-align: center; }
    .brand { color: #f59e0b; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .content { padding: 32px 28px; text-align: center; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px 0; }
    .desc { font-size: 14px; color: #475569; line-height: 1.6; margin-bottom: 24px; }
    .otp-box { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 18px; display: inline-block; margin: 12px 0 24px; min-width: 200px; }
    .otp-code { font-family: monospace; font-size: 32px; font-weight: 800; color: #0f172a; letter-spacing: 8px; }
    .notice { font-size: 13px; color: #64748b; margin-top: 16px; background-color: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
    .footer { background: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="email-card">
    <div class="header">
      <div class="brand">🎓 Project Eklavya</div>
    </div>
    <div class="content">
      <h2 class="title">Password Reset Verification</h2>
      <p class="desc">
        Hello <strong>${studentName || 'Student'}</strong>,<br>
        We received a request to reset your Project Eklavya account password. Use the verification code (OTP) below to proceed:
      </p>

      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>

      <div class="notice">
        ⏱️ This verification code is valid for <strong>${expiryMinutes} minutes</strong>. Do not share this code with anyone.
      </div>
    </div>
    <div class="footer">
      If you did not request a password reset, you can safely ignore this email.
    </div>
  </div>
</body>
</html>
  `;
}
