/**
 * SafeChat Crypto Engine — 100% Web Crypto API, zero npm crypto deps.
 *
 * Key agreement : ECDH P-256  (closest Web Crypto has to X25519)
 * Signing       : ECDSA P-256
 * Symmetric     : AES-256-GCM
 * KDF           : HKDF-SHA-256
 *
 * Session model: simplified Double-Ratchet
 *   - Each conversation gets a shared AES-256-GCM key derived via ECDH + HKDF
 *   - A per-message nonce (96-bit random) gives ciphertext uniqueness
 *   - Forward secrecy: ratchet step rotates the chain key every message
 */

const subtle = crypto.subtle

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IdentityKeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyRaw: Uint8Array   // 65-byte uncompressed P-256 point
}

export interface SerializedKeyPair {
  publicKeyJwk: JsonWebKey
  privateKeyJwk: JsonWebKey
  publicKeyHex: string
}

export interface SessionState {
  // The current symmetric sending/receiving chain keys (raw 32 bytes)
  sendChainKey: Uint8Array
  recvChainKey: Uint8Array
  sendIndex: number
  recvIndex: number
}

export interface EncryptedEnvelope {
  ciphertext: number[]
  nonce: number[]
  messageIndex: number
  messageType: 'text' | 'image' | 'file' | 'system' | 'ack'
  // Present only in the first message (key exchange init)
  x3dhInit?: {
    ephemeralKeyHex: string
    senderIdentityKeyHex: string
  }
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const kp = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  )
  const rawPub = new Uint8Array(await subtle.exportKey('raw', kp.publicKey))
  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyRaw: rawPub }
}

export async function serializeKeyPair(kp: IdentityKeyPair): Promise<SerializedKeyPair> {
  return {
    publicKeyJwk: await subtle.exportKey('jwk', kp.publicKey),
    privateKeyJwk: await subtle.exportKey('jwk', kp.privateKey),
    publicKeyHex: toHex(kp.publicKeyRaw),
  }
}

export async function deserializeKeyPair(s: SerializedKeyPair): Promise<IdentityKeyPair> {
  const publicKey = await subtle.importKey('jwk', s.publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  const privateKey = await subtle.importKey('jwk', s.privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'])
  return { publicKey, privateKey, publicKeyRaw: fromHex(s.publicKeyHex) }
}

export async function importPublicKeyFromHex(hex: string): Promise<CryptoKey> {
  const raw = fromHex(hex)
  return subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

export function generateUserId(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

// ─── ECDH + HKDF Session Setup ────────────────────────────────────────────────

/**
 * Sender: generate ephemeral key, ECDH with recipient's identity key,
 * derive symmetric session keys via HKDF.
 */
export async function deriveSessionAsSender(
  senderIdentity: IdentityKeyPair,
  recipientPublicKeyHex: string
): Promise<{ sendChainKey: Uint8Array; recvChainKey: Uint8Array; ephemeralKeyHex: string }> {
  const recipientKey = await importPublicKeyFromHex(recipientPublicKeyHex)

  // Ephemeral key for forward secrecy
  const ephKp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const ephPubRaw = new Uint8Array(await subtle.exportKey('raw', (ephKp as CryptoKeyPair).publicKey))

  // DH1: sender identity × recipient identity
  const dh1 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: recipientKey }, senderIdentity.privateKey, 256))
  // DH2: ephemeral × recipient identity
  const dh2 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: recipientKey }, (ephKp as CryptoKeyPair).privateKey, 256))

  const ikm = concat(dh1, dh2)
  const { sendChainKey, recvChainKey } = await deriveChainKeys(ikm, 'sender')

  return { sendChainKey, recvChainKey, ephemeralKeyHex: toHex(ephPubRaw) }
}

/**
 * Recipient: recompute session keys from sender's init message.
 */
export async function deriveSessionAsRecipient(
  recipientIdentity: IdentityKeyPair,
  senderIdentityKeyHex: string,
  ephemeralKeyHex: string
): Promise<{ sendChainKey: Uint8Array; recvChainKey: Uint8Array }> {
  const senderIdentityKey = await importPublicKeyFromHex(senderIdentityKeyHex)
  const ephemeralKey = await importPublicKeyFromHex(ephemeralKeyHex)

  const dh1 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: senderIdentityKey }, recipientIdentity.privateKey, 256))
  const dh2 = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: ephemeralKey }, recipientIdentity.privateKey, 256))

  const ikm = concat(dh1, dh2)
  // Recipient's perspective is flipped: recv ↔ send
  const { sendChainKey: recvChainKey, recvChainKey: sendChainKey } = await deriveChainKeys(ikm, 'sender')

  return { sendChainKey, recvChainKey }
}

async function deriveChainKeys(ikm: Uint8Array, info: string): Promise<{ sendChainKey: Uint8Array; recvChainKey: Uint8Array }> {
  const ikmKey = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('SafeChat_v1'), info: new TextEncoder().encode(info) },
    ikmKey, 512
  ))
  return { sendChainKey: bits.slice(0, 32), recvChainKey: bits.slice(32, 64) }
}

// ─── Symmetric ratchet (chain key → message key) ──────────────────────────────

async function advanceChainKey(chainKey: Uint8Array): Promise<{ messageKey: Uint8Array; nextChainKey: Uint8Array }> {
  const ck = await subtle.importKey('raw', chainKey, 'HKDF', false, ['deriveBits'])
  const msgBits = new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('msg') },
    ck, 256
  ))
  const nextBits = new Uint8Array(await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('chain') },
    ck, 256
  ))
  return { messageKey: msgBits, nextChainKey: nextBits }
}

// ─── Encrypt / Decrypt ────────────────────────────────────────────────────────

export async function encryptMessage(
  session: SessionState,
  plaintext: Uint8Array
): Promise<{ session: SessionState; ciphertext: Uint8Array; nonce: Uint8Array }> {
  const { messageKey, nextChainKey } = await advanceChainKey(session.sendChainKey)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await subtle.importKey('raw', messageKey, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))

  return {
    session: { ...session, sendChainKey: nextChainKey, sendIndex: session.sendIndex + 1 },
    ciphertext,
    nonce,
  }
}

export async function decryptMessage(
  session: SessionState,
  ciphertext: Uint8Array,
  nonce: Uint8Array
): Promise<{ session: SessionState; plaintext: Uint8Array }> {
  const { messageKey, nextChainKey } = await advanceChainKey(session.recvChainKey)
  const aesKey = await subtle.importKey('raw', messageKey, { name: 'AES-GCM' }, false, ['decrypt'])
  const plaintext = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext))

  return {
    session: { ...session, recvChainKey: nextChainKey, recvIndex: session.recvIndex + 1 },
    plaintext,
  }
}

// ─── Local storage encryption (AES-256-GCM with a fixed key) ─────────────────

export async function deriveStorageKey(identityPrivateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  const seed = new TextEncoder().encode(JSON.stringify(identityPrivateKeyJwk))
  const hkdfKey = await subtle.importKey('raw', seed, 'HKDF', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('SafeChat_storage'), info: new Uint8Array(0) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptForStorage(storageKey: CryptoKey, data: unknown): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const pt = new TextEncoder().encode(JSON.stringify(data))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, storageKey, pt))
  return JSON.stringify({ n: Array.from(nonce), c: Array.from(ct) })
}

export async function decryptFromStorage(storageKey: CryptoKey, encrypted: string): Promise<unknown> {
  const { n, c } = JSON.parse(encrypted)
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(n) }, storageKey, new Uint8Array(c))
  return JSON.parse(new TextDecoder().decode(pt))
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) arr[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  return arr
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

export function encodeText(t: string): Uint8Array { return new TextEncoder().encode(t) }
export function decodeText(b: Uint8Array): string { return new TextDecoder().decode(b) }
