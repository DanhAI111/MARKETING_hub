const net = require('node:net');
const tls = require('node:tls');

const DEFAULT_TIMEOUT_MS = 15000;

const configured = () => !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_FROM);

const address = (value) => String(value || '').trim();

const envelopeAddress = (value) => {
  const match = address(value).match(/<([^>]+)>/);
  return match ? match[1] : address(value);
};

const encodeHeader = (value) => /[^\x20-\x7e]/.test(String(value || ''))
  ? `=?UTF-8?B?${Buffer.from(String(value || ''), 'utf8').toString('base64')}?=`
  : String(value || '');

const normalizeRecipients = (to) => [...new Set((Array.isArray(to) ? to : [to])
  .map(address)
  .filter(Boolean))];

const dotStuff = (value) => String(value || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

const createMessage = ({ from, to, subject, text, html, replyTo }) => {
  const boundary = `mh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@marketing-hub.local>`
  ];
  if (!html) {
    return `${headers.join('\r\n')}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(text)}\r\n`;
  }
  return `${headers.join('\r\n')}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`
    + `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(text)}\r\n`
    + `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(html)}\r\n`
    + `--${boundary}--\r\n`;
};

const connect = ({ host, port, secure }) => new Promise((resolve, reject) => {
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  socket.setTimeout(Number(process.env.SMTP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  socket.once('error', reject);
  socket.once('timeout', () => reject(new Error('SMTP connection timed out')));
  socket.once('connect', () => {
    socket.removeListener('error', reject);
    resolve(socket);
  });
});

const readResponse = (socket) => new Promise((resolve, reject) => {
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    if (lines.length && /^\d{3} /.test(lines[lines.length - 1])) {
      cleanup();
      resolve(buffer);
    }
  };
  const onError = (err) => { cleanup(); reject(err); };
  const cleanup = () => {
    socket.off('data', onData);
    socket.off('error', onError);
  };
  socket.on('data', onData);
  socket.once('error', onError);
});

const command = async (socket, line, expected = /^[23]/) => {
  socket.write(`${line}\r\n`);
  const response = await readResponse(socket);
  if (!expected.test(response)) throw new Error(`SMTP command failed: ${response.trim()}`);
  return response;
};

const upgradeTls = (socket, host) => new Promise((resolve, reject) => {
  const secureSocket = tls.connect({ socket, servername: host }, () => resolve(secureSocket));
  secureSocket.once('error', reject);
});

const sendViaSmtp = async ({ to, subject, text, html }) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  const from = process.env.SMTP_FROM;
  const replyTo = process.env.SMTP_REPLY_TO || '';
  const recipients = normalizeRecipients(to);
  if (!recipients.length) return { skipped: true, reason: 'no-recipients' };

  let socket = await connect({ host, port, secure });
  try {
    await readResponse(socket);
    await command(socket, `EHLO ${process.env.SMTP_HELO || 'localhost'}`);
    if (!secure && process.env.SMTP_STARTTLS !== '0') {
      await command(socket, 'STARTTLS', /^220/);
      socket = await upgradeTls(socket, host);
      await command(socket, `EHLO ${process.env.SMTP_HELO || 'localhost'}`);
    }
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const token = Buffer.from(`\u0000${process.env.SMTP_USER}\u0000${process.env.SMTP_PASS}`).toString('base64');
      await command(socket, `AUTH PLAIN ${token}`, /^235/);
    }
    await command(socket, `MAIL FROM:<${envelopeAddress(from)}>`);
    for (const recipient of recipients) {
      await command(socket, `RCPT TO:<${envelopeAddress(recipient)}>`);
    }
    await command(socket, 'DATA', /^354/);
    socket.write(`${createMessage({ from, to: recipients, subject, text, html, replyTo })}\r\n.\r\n`);
    const response = await readResponse(socket);
    if (!/^250/.test(response)) throw new Error(`SMTP DATA failed: ${response.trim()}`);
    await command(socket, 'QUIT').catch(() => null);
    return { sent: recipients.length };
  } finally {
    socket.destroy();
  }
};

const sendEmail = async (message) => {
  if (!configured()) {
    console.info('Task email notification skipped: SMTP_HOST, SMTP_PORT, or SMTP_FROM is not configured.');
    return { skipped: true, reason: 'not-configured' };
  }
  return sendViaSmtp(message);
};

module.exports = { configured, sendEmail };
