const crypto = require('crypto');

function getKey() {
  const raw = process.env.MASTER_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      'MASTER_KEY is missing or too short. Set a 32+ char (ideally 64 hex char) secret in your environment.'
    );
  }
  // Derive a stable 32-byte key from whatever string the operator provided.
  return crypto.createHash('sha256').update(raw).digest();
}

// Returns a single string "iv:authTag:ciphertext" (all hex) so it can be stored as plain text in JSON.
function encrypt(plainText) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function decrypt(payload) {
  const key = getKey();
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !tagHex || !dataHex) throw new Error('Malformed encrypted payload.');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
