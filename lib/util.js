// @ts-check
// Leaf utilities extracted from server.js. Pure helpers with no dependency on
// application state (no `db`, no tournament objects) - only Node built-ins.
// Behaviour is identical to the previous in-server definitions; this file only
// moves them so server.js can `require` them. Keep it dependency-free.
'use strict';

const crypto = require('crypto');

/** @typedef {import('http').IncomingMessage} IncomingMessage */
/** @typedef {import('http').ServerResponse} ServerResponse */

/**
 * Random hex id.
 * @param {number} [len] byte length (default 8)
 * @returns {string}
 */
function uid(len) { return crypto.randomBytes(len || 8).toString('hex'); }

/** @returns {number} current epoch ms */
function now() { return Date.now(); }

/**
 * In-place Fisher-Yates shuffle.
 * @template T
 * @param {T[]} a
 * @returns {T[]} the same array, shuffled
 */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/**
 * Strip angle brackets, trim, and cap length. Non-strings become ''.
 * @param {unknown} s
 * @param {number} [max] default 40
 * @returns {string}
 */
function cleanName(s, max) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>]/g, '').trim().slice(0, max || 40);
}

/**
 * Parse an int and clamp it to [lo, hi], else return the default.
 * @param {unknown} v
 * @param {number} lo
 * @param {number} hi
 * @param {number} dflt
 * @returns {number}
 */
function intIn(v, lo, hi, dflt) {
  const n = parseInt(/** @type {string} */ (v), 10);
  return (n >= lo && n <= hi) ? n : dflt;
}

/**
 * Normalise a date string. Accepts legacy YYYY-MM-DD or full ISO; returns a
 * UTC ISO string (or the legacy date unchanged), or null if unparseable.
 * @param {unknown} v
 * @returns {string|null}
 */
function cleanDate(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  // legacy date-only
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // full ISO datetime (what the client sends now) - validate by parsing
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString(); // normalize to UTC ISO
}

/**
 * Write a JSON response with no-store caching.
 * @param {ServerResponse} res
 * @param {number} code
 * @param {unknown} obj
 */
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/**
 * 400 with an { error } body.
 * @param {ServerResponse} res
 * @param {string} msg
 */
function bad(res, msg) { json(res, 400, { error: msg }); }

/**
 * Read and JSON-parse a request body, rejecting oversized or malformed input.
 * Empty body resolves to {}.
 * @param {IncomingMessage} req
 * @param {number} [maxBytes] default 200000
 * @returns {Promise<any>}
 */
function readBody(req, maxBytes) {
  const limit = maxBytes || 200000;
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

/**
 * base64url-encode a Buffer (RFC 4648, no padding).
 * @param {Buffer} buf
 * @returns {string}
 */
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Random base64url token.
 * @param {number} [nbytes] default 32
 * @returns {string}
 */
function randToken(nbytes) { return b64url(crypto.randomBytes(nbytes || 32)); }

/**
 * PKCE pair: verifier is a random string; challenge is base64url(sha256(verifier)).
 * @returns {{ verifier: string, challenge: string }}
 */
function pkcePair() {
  const verifier = randToken(48);
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

module.exports = {
  uid, now, shuffle, cleanName, intIn, cleanDate,
  json, bad, readBody, b64url, randToken, pkcePair,
};
