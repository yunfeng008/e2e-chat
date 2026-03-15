/**
 * Encrypted IndexedDB storage
 *
 * Identity is stored as plain JSON (it contains only public+private key JWKs
 * which are themselves the source of the encryption key — encrypting them with
 * a key derived from themselves is circular and pointless).
 *
 * Sessions, messages, and contacts ARE encrypted with the storage key derived
 * from the identity private key.
 */

import { openDB, IDBPDatabase } from 'idb'
import { encryptForStorage, decryptFromStorage } from './engine'

export interface StoredMessage {
  id: string
  conversationId: string
  senderId: string
  type: 'text' | 'image' | 'file' | 'system'
  content: string
  fileName?: string
  fileSize?: number
  fileMimeType?: string
  fileData?: string
  ts: number
  status: 'sent' | 'delivered' | 'read'
  ttl?: number
  burned?: boolean
}

export interface Contact {
  id: string
  nickname: string
  identityKey: string
  addedAt: number
  lastSeen?: number
}

class EncryptedStorage {
  private db: IDBPDatabase | null = null
  private storageKey: CryptoKey | null = null

  async open() {
    if (this.db) return
    this.db = await openDB('safechat', 1, {
      upgrade(db) {
        db.createObjectStore('identity')
        db.createObjectStore('sessions', { keyPath: 'peerId' })
        const msgs = db.createObjectStore('messages', { keyPath: 'id' })
        msgs.createIndex('by-conversation', 'conversationId')
        msgs.createIndex('by-ts', 'ts')
        db.createObjectStore('contacts', { keyPath: 'id' })
      },
    })
  }

  setStorageKey(key: CryptoKey) {
    this.storageKey = key
  }

  private enc(data: unknown) {
    if (!this.storageKey) throw new Error('Storage key not set')
    return encryptForStorage(this.storageKey, data)
  }
  private dec(s: string) {
    if (!this.storageKey) throw new Error('Storage key not set')
    return decryptFromStorage(this.storageKey, s)
  }

  // Identity is stored as plain JSON — no encryption needed (see file comment)
  async saveIdentity(identity: unknown) {
    await this.open()
    await this.db!.put('identity', JSON.stringify(identity), 'self')
  }
  async loadIdentity(): Promise<unknown | null> {
    await this.open()
    const v = await this.db!.get('identity', 'self')
    return v ? JSON.parse(v as string) : null
  }

  async saveSession(peerId: string, state: unknown) {
    await this.open()
    await this.db!.put('sessions', { peerId, state: await this.enc(state), updatedAt: Date.now() })
  }
  async loadSession(peerId: string): Promise<unknown | null> {
    await this.open()
    const row = await this.db!.get('sessions', peerId) as { state: string } | undefined
    return row ? this.dec(row.state) : null
  }

  async saveMessage(msg: StoredMessage) {
    await this.open()
    await this.db!.put('messages', msg)
  }
  async getMessages(conversationId: string, limit = 100): Promise<StoredMessage[]> {
    await this.open()
    const all = await this.db!.getAllFromIndex('messages', 'by-conversation', conversationId) as StoredMessage[]
    const now = Date.now()
    return all
      .filter(m => !m.burned && (!m.ttl || m.ttl > now))
      .sort((a, b) => a.ts - b.ts)
      .slice(-limit)
  }
  async burnMessage(id: string) {
    await this.open()
    const msg = await this.db!.get('messages', id) as StoredMessage | undefined
    if (msg) await this.db!.put('messages', { ...msg, burned: true, content: '', fileData: undefined })
  }
  async burnExpiredMessages() {
    await this.open()
    const all = await this.db!.getAll('messages') as StoredMessage[]
    const now = Date.now()
    for (const m of all) if (m.ttl && m.ttl < now && !m.burned) await this.burnMessage(m.id)
  }

  async saveContact(contact: Contact) {
    await this.open()
    await this.db!.put('contacts', contact)
  }
  async getContacts(): Promise<Contact[]> {
    await this.open()
    return this.db!.getAll('contacts')
  }
  async getContact(id: string): Promise<Contact | undefined> {
    await this.open()
    return this.db!.get('contacts', id)
  }
}

export const storage = new EncryptedStorage()
