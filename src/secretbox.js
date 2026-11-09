// One place for the way this app seals secrets on disk.
//
// RULE ADDED 2026-11-08 (1.1.2): the wallet and the bump roster both keep private keys, and a second copy of the crypto
// is a second chance to get it wrong. This is the same scheme the wallet file has always used - scrypt (N=32768) for the
// key, AES-256-GCM for the bytes, salt and iv fresh on every write - so a wallet written before this refactor still
// opens, and the roster gets exactly the same guarantees.
const crypto = require('crypto');

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

/** Encrypt bytes or a string. The returned object is plain hex, which is what a JSON file can hold. */
function seal(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: data.toString('hex'),
  };
}

/**
 * Decrypt what `seal` wrote. A wrong password and a damaged file are indistinguishable on purpose: AES-GCM cannot tell
 * them apart, and guessing which one it was would only mislead. Throws 'Wrong password.' for both.
 */
function open(blob, password) {
  try {
    const key = crypto.scryptSync(password, Buffer.from(blob.salt, 'hex'), 32, SCRYPT);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(blob.data, 'hex')), decipher.final()]);
  } catch (_) {
    throw new Error('Wrong password.');
  }
}

/** True when an object looks like something `seal` produced, without touching the password. */
function isSealed(blob) {
  if (!blob || typeof blob !== 'object') return false;
  return ['salt', 'iv', 'tag', 'data'].every((k) => typeof blob[k] === 'string' && /^[0-9a-f]+$/i.test(blob[k]));
}

module.exports = { seal, open, isSealed, SCRYPT };
