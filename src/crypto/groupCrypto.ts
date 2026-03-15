/**
 * Group crypto — Sender Keys 方案
 * 群主生成 AES-256-GCM 群密钥，用每个成员的 ECDH 公钥单独加密后发送
 * 服务器只转发密文，无法解密任何群消息
 */

const subtle = crypto.subtle

export interface GroupInfo {
  id: string              // 随机 UUID
  name: string
  creatorId: string
  members: GroupMember[]
  createdAt: number
}

export interface GroupMember {
  userId: string
  displayName: string
  identityKeyHex: string  // 用于加密群密钥
}

export interface EncryptedGroupKey {
  recipientId: string
  encryptedKey: number[]  // 用接收方公钥加密的群密钥
  nonce: number[]
}

// ── 群密钥生成 ──────────────────────────────────────────────────────────────

export async function generateGroupKey(): Promise<Uint8Array> {
  const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return new Uint8Array(await subtle.exportKey('raw', key))
}

// ── 把群密钥用 ECDH 加密发给某成员 ─────────────────────────────────────────

export async function encryptGroupKeyForMember(
  groupKey: Uint8Array,
  senderPrivateKey: CryptoKey,
  recipientPublicKeyHex: string
): Promise<{ encryptedKey: number[]; nonce: number[] }> {
  // ECDH 派生共享密钥
  const recipientPub = await importECDHPublicKey(recipientPublicKeyHex)
  const sharedBits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: recipientPub }, senderPrivateKey, 256))
  const sharedKey = await subtle.importKey('raw', sharedBits, { name: 'AES-GCM' }, false, ['encrypt'])

  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sharedKey, groupKey))
  return { encryptedKey: Array.from(ct), nonce: Array.from(nonce) }
}

// ── 成员解密群密钥 ──────────────────────────────────────────────────────────

export async function decryptGroupKey(
  encryptedKey: number[],
  nonce: number[],
  recipientPrivateKey: CryptoKey,
  senderPublicKeyHex: string
): Promise<Uint8Array> {
  const senderPub = await importECDHPublicKey(senderPublicKeyHex)
  const sharedBits = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: senderPub }, recipientPrivateKey, 256))
  const sharedKey = await subtle.importKey('raw', sharedBits, { name: 'AES-GCM' }, false, ['decrypt'])
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, sharedKey, new Uint8Array(encryptedKey))
  return new Uint8Array(pt)
}

// ── 用群密钥加密消息 ────────────────────────────────────────────────────────

export async function encryptGroupMessage(groupKey: Uint8Array, plaintext: Uint8Array): Promise<{ ciphertext: number[]; nonce: number[] }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const aesKey = await subtle.importKey('raw', groupKey, { name: 'AES-GCM' }, false, ['encrypt'])
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))
  return { ciphertext: Array.from(ct), nonce: Array.from(nonce) }
}

// ── 用群密钥解密消息 ────────────────────────────────────────────────────────

export async function decryptGroupMessage(groupKey: Uint8Array, ciphertext: number[], nonce: number[]): Promise<Uint8Array> {
  const aesKey = await subtle.importKey('raw', groupKey, { name: 'AES-GCM' }, false, ['decrypt'])
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce) }, aesKey, new Uint8Array(ciphertext)))
}

// ── 工具 ────────────────────────────────────────────────────────────────────

export function generateGroupId(): string {
  return crypto.randomUUID()
}

async function importECDHPublicKey(hex: string): Promise<CryptoKey> {
  const raw = fromHex(hex)
  return subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
}

export function toHex(b: Uint8Array) { return Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('') }
export function fromHex(h: string) { const a = new Uint8Array(h.length/2); for(let i=0;i<h.length;i+=2) a[i/2]=parseInt(h.slice(i,i+2),16); return a }
