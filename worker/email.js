export const configured = (env) => !!(env.RESEND_API_KEY && env.EMAIL_FROM);

const normalizeRecipients = (to) => [...new Set((Array.isArray(to) ? to : [to])
  .map((value) => String(value || '').trim())
  .filter(Boolean))];

export const sendEmail = async (env, { to, subject, text, html }) => {
  if (!configured(env)) {
    console.info('Task email notification skipped: RESEND_API_KEY or EMAIL_FROM is not configured.');
    return { skipped: true, reason: 'not-configured' };
  }
  const recipients = normalizeRecipients(to);
  if (!recipients.length) return { skipped: true, reason: 'no-recipients' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: recipients,
      subject,
      text,
      html,
      ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {})
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Resend email failed: ${response.status}`);
  return { sent: recipients.length, id: body.id || '' };
};
