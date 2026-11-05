'use strict';
// Rules ship encoded (gzip + rolling XOR) so the plaintext patterns never sit on disk
// (prevents other scanners — and ourselves — from flagging the rule pack).
const zlib = require('zlib');
const { RuleSet } = require('./rules');
const KEY = Buffer.from('DT-Kalkan/2026::Development-Turkey', 'latin1');

function xor(buf) {
  const out = Buffer.allocUnsafe(buf.length);
  let k = 0x5a;
  for (let i = 0; i < buf.length; i++) { k = (k * 31 + KEY[i % KEY.length]) & 0xff; out[i] = buf[i] ^ k; }
  return out;
}
function encode(text) { return Buffer.concat([Buffer.from('DTRL1'), xor(zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }))]); }
function decode(buf) {
  if (buf.toString('latin1', 0, 5) !== 'DTRL1') throw new Error('invalid rule pack');
  return zlib.gunzipSync(xor(buf.subarray(5))).toString('utf8');
}
function load(buf) { return RuleSet.fromText(decode(buf)); }
module.exports = { encode, decode, load };
