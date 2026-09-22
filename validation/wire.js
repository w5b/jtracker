// Parsers for controlled, bounded test traffic, not production network input.
const grease = value => (value & 0x0f0f) === 0x0a0a && value >> 8 === (value & 255);
const norm = value => grease(value) ? 'GREASE' : value;
const u16s = buffer => Array.from({ length: buffer.length / 2 }, (_, i) => norm(buffer.readUInt16BE(i * 2)));
const names = {
  0: 'server_name', 5: 'status_request', 10: 'supported_groups', 11: 'ec_point_formats',
  13: 'signature_algorithms', 16: 'application_layer_protocol_negotiation',
  18: 'signed_certificate_timestamp', 23: 'extended_master_secret', 27: 'compress_certificate',
  35: 'session_ticket', 41: 'pre_shared_key', 43: 'supported_versions', 45: 'psk_key_exchange_modes',
  51: 'keyshare', 65037: 'encrypted_client_hello', 65281: 'renegotiation_info',
  17513: 'application_settings', 17613: 'application_settings_new',
};
function protocols(data) {
  const result = [];
  for (let offset = 2; offset < data.length;) { const n = data[offset++]; result.push(data.toString('ascii', offset, offset + n)); offset += n; }
  return result;
}
export function clientHello(records) {
  let offset = 0, fragments = [], recordVersion;
  while (offset + 5 <= records.length) {
    const type = records[offset], length = records.readUInt16BE(offset + 3);
    if (offset + 5 + length > records.length) return null;
    if (type !== 22) return null;
    recordVersion ??= records.readUInt16BE(offset + 1);
    fragments.push(records.subarray(offset + 5, offset + 5 + length)); offset += 5 + length;
    const message = Buffer.concat(fragments);
    if (message.length < 4 || message.length < 4 + message.readUIntBE(1, 3)) continue;
    if (message[0] !== 1) throw new Error('Expected ClientHello');
    const body = message.subarray(4, 4 + message.readUIntBE(1, 3));
    let p = 34;
    const sessionIdLength = body[p++]; p += sessionIdLength;
    const cipherLength = body.readUInt16BE(p); p += 2;
    const ciphersuites = u16s(body.subarray(p, p + cipherLength)); p += cipherLength;
    const compLength = body[p++], compMethods = [...body.subarray(p, p + compLength)]; p += compLength;
    const extensionLength = body.readUInt16BE(p); p += 2;
    const end = p + extensionLength, extensions = [];
    while (p < end) {
      const id = body.readUInt16BE(p), length = body.readUInt16BE(p + 2); p += 4;
      const data = body.subarray(p, p + length); p += length;
      const extension = { type: grease(id) ? 'GREASE' : names[id] || id, length };
      if ([16, 17513, 17613].includes(id)) extension[id === 16 ? 'alpn_list' : 'alps_alpn_list'] = protocols(data);
      if (id === 10) extension.supported_groups = u16s(data.subarray(2));
      if (id === 11) extension.ec_point_formats = [...data.subarray(1)];
      if (id === 13) extension.sig_hash_algs = u16s(data.subarray(2));
      if (id === 27) extension.algorithms = u16s(data.subarray(1));
      if (id === 43) extension.supported_versions = u16s(data.subarray(1)).map(x => ({ 772: 'TLS_VERSION_1_3', 771: 'TLS_VERSION_1_2' }[x] || x));
      if (id === 45) extension.psk_ke_mode = data[1];
      if (id === 5) extension.status_request_type = data[0];
      if (id === 51) {
        extension.key_shares = [];
        for (let k = 2; k < data.length;) {
          const group = norm(data.readUInt16BE(k)), size = data.readUInt16BE(k + 2);
          extension.key_shares.push({ group, length: size }); k += 4 + size;
        }
      }
      extensions.push(extension);
    }
    return { record_version: recordVersion === 769 ? 'TLS_VERSION_1_0' : recordVersion,
      handshake_version: body.readUInt16BE(0) === 771 ? 'TLS_VERSION_1_2' : body.readUInt16BE(0),
      session_id_length: sessionIdLength, ciphersuites, comp_methods: compMethods, extensions };
  }
  return null;
}

export function frame(type, flags, streamId, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(9); header.writeUIntBE(payload.length, 0, 3);
  header[3] = type; header[4] = flags; header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}

export function observeWebSocketFrames(records) {
  let pending = Buffer.alloc(0);
  return chunk => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      let length = pending[1] & 127, offset = 2;
      if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); offset = 10; }
      const masked = !!(pending[1] & 128); if (masked) offset += 4;
      if (pending.length < offset + length) return;
      records.push({ fin: !!(pending[0] & 128), rsv1: !!(pending[0] & 64), opcode: pending[0] & 15, masked, length,
        ...(masked ? { mask: pending.subarray(offset - 4, offset).toString('hex') } : {}) });
      pending = pending.subarray(offset + length);
    }
  };
}
