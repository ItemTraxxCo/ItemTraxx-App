const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const random = (length) => crypto.getRandomValues(new Uint8Array(length));
const encode = (bytes) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
const decode = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const aad = (...parts) => encoder.encode(JSON.stringify(parts));
const aesKey = (raw, usages) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, usages);

async function seal(rawKey, context, bytes) {
  const nonce = random(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: context, tagLength: 128 },
    await aesKey(rawKey, ['encrypt']), bytes,
  ));
  return { ciphertext: encode(sealed.subarray(0, -16)), nonce: encode(nonce), auth_tag: encode(sealed.subarray(-16)) };
}

async function open(rawKey, context, envelope) {
  const nonce = decode(envelope.nonce);
  const ciphertext = decode(envelope.ciphertext);
  const tag = decode(envelope.auth_tag);
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid envelope');
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: context, tagLength: 128 },
    await aesKey(rawKey, ['decrypt']), sealed,
  ));
}

export async function generateWorkspaceKeys(kek, workspaceId) {
  if (kek.length !== 32) throw new Error('Invalid KEK');
  return {
    version: 1,
    wrapped_dek: await seal(kek, aad('itemtraxx', 'key', 1, workspaceId, 'dek'), random(32)),
    wrapped_pepper: await seal(kek, aad('itemtraxx', 'key', 1, workspaceId, 'pepper'), random(32)),
  };
}

export async function unwrapWorkspaceKeys(kek, workspaceId, wrapped) {
  if (kek.length !== 32 || wrapped.version !== 1) throw new Error('Invalid key envelope');
  const [dek, pepper] = await Promise.all([
    open(kek, aad('itemtraxx', 'key', 1, workspaceId, 'dek'), wrapped.wrapped_dek),
    open(kek, aad('itemtraxx', 'key', 1, workspaceId, 'pepper'), wrapped.wrapped_pepper),
  ]);
  if (dek.length !== 32 || pepper.length !== 32) throw new Error('Invalid key length');
  return { dek, pepper };
}

export async function encryptPayload(dek, workspaceId, recordId, payload) {
  return seal(dek, aad('itemtraxx', 'borrower', 1, workspaceId, recordId), encoder.encode(JSON.stringify(payload)));
}

export async function decryptPayload(dek, workspaceId, recordId, envelope) {
  return JSON.parse(decoder.decode(await open(dek, aad('itemtraxx', 'borrower', 1, workspaceId, recordId), envelope)));
}

export async function blindIndexes(pepper, values) {
  const key = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = {};
  for (const [field, output] of [['borrower_id', 'borrower_id_hash'], ['email', 'borrower_email_hash']]) {
    if (values[field] === undefined) continue;
    if (typeof values[field] !== 'string' || !values[field].trim()) throw new Error('Invalid index value');
    const input = aad('itemtraxx', 'blind-index', 1, field, values[field].trim().toLowerCase());
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, input));
    result[output] = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return result;
}
