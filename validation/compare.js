// Deliberately compare individual reference fields, not a JA3/JA4 hash.
import { isDeepStrictEqual } from 'node:util';

export function compareTLS(observed, reference) {
  const checks = [], unknown = [];
  const check = (field, actual, expected) => checks.push({ field, pass: isDeepStrictEqual(actual, expected), actual, expected });
  for (const field of ['record_version', 'handshake_version', 'session_id_length', 'ciphersuites', 'comp_methods']) check(field, observed[field], reference[field]);
  // Chromium permutes extensions and rotates GREASE values. Keep multiplicity,
  // normalize only GREASE values and order, never remove arbitrary extensions.
  check('extension multiset', observed.extensions.map(e => e.type).sort(), reference.extensions.map(e => e.type).sort());
  for (const [index, expected] of reference.extensions.entries()) {
    const candidates = observed.extensions.filter(e => e.type === expected.type);
    const actual = expected.type === 'GREASE' ? candidates.find(e => e.length === expected.length) : candidates[0];
    if (!actual) continue; // extension multiset already reports this
    for (const [key, value] of Object.entries(expected)) {
      if (key === 'type' || key === 'data') continue;
      if (expected.type === 'encrypted_client_hello' && key === 'length' && value === 0) {
        unknown.push('Reference ECH length=0 is a placeholder; its ciphertext, payload shape and length are not validated.'); continue;
      }
      check(`extensions[${index}].${expected.type}.${key}`, actual[key], value);
    }
  }
  unknown.push('Session IDs, key bytes, random fields, SNI payload, ECH contents, extension permutation distribution, resumption and encrypted TLS records are not reference-validated.');
  return { checks, unknown };
}

export function compareHTTP2(connection, reference) {
  const settings = connection.http2.find(f => f.type === 4 && !(f.flags & 1));
  const window = connection.http2.find(f => f.type === 8 && f.streamId === 0);
  const headers = connection.http2.find(f => f.type === 1)?.headers || [];
  const expected = reference.frames;
  const comparisons = [
    ['settings values and order', settings?.settings, expected.find(f => f.frame_type === 'SETTINGS').settings],
    ['connection window increment', window?.increment, expected.find(f => f.frame_type === 'WINDOW_UPDATE').window_size_increment],
    ['first frame types', connection.http2.slice(0, 3).map(f => f.type), [4, 8, 1]],
    ['pseudo-header order', headers.filter(([key]) => key.startsWith(':')).map(([key]) => key), expected.find(f => f.frame_type === 'HEADERS').pseudo_headers],
    ['navigation header values and order', headers.filter(([key]) => !key.startsWith(':')).map(([key, value]) => `${key}: ${value}`), expected.find(f => f.frame_type === 'HEADERS').headers],
  ];
  return comparisons.map(([field, actual, expected]) => ({ field, pass: isDeepStrictEqual(actual, expected), actual, expected }));
}
