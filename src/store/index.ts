import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  generateIdentityKeyPair, serializeKeyPair, deserializeKeyPair,
  deriveSessionAsSender, deriveSessionAsRecipient,
  encryptMessage, decryptMessage, deriveStorageKey,
  generateUserId, toHex, encodeText, decodeText,
  type IdentityKeyPair, type SessionState, type SerializedKeyPair,
} from '../crypto/engine'
import { storage, type StoredMessage, type Contact } from '../crypto/storage'
import { network, type EncryptedEnvelope } from '../crypto/network'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Message {
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

export interface Conversation {
  peerId: string
  peerName: string
  peerIdentityKey: string   // hex
  messages: Message[]
  unread: number
  lastMessage?: string
  lastTs?: number
  isOnline: boolean
  isTyping: boolean
}

interface StoredIdentity {
  userId: string
  displayName: string
  keyPair: SerializedKeyPair
}

interface RuntimeIdentity {
  userId: string
  displayName: string
  keyPair: IdentityKeyPair
}

interface AppState {
  identity: RuntimeIdentity | null
  conversations: Map<string, Conversation>
  activeConversationId: string | null
  defaultTtl: number | null
  isInitialized: boolean
  isOnboarding: boolean

  initApp: () => Promise<void>
  createIdentity: (displayName: string) => Promise<void>
  addContact: (contactId: string, identityKeyHex: string, nickname: string) => Promise<void>
  selectConversation: (peerId: string) => void
  sendMessage: (peerId: string, content: string, type?: Message['type'], fileData?: string, fileName?: string, fileSize?: number, fileMimeType?: string) => Promise<void>
  setDefaultTtl: (ttl: number | null) => void
  getQRData: () => string
}

// ─── Session cache ────────────────────────────────────────────────────────────

const sessionCache = new Map<string, SessionState>()

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    identity: null,
    conversations: new Map(),
    activeConversationId: null,
    defaultTtl: null,
    isInitialized: false,
    isOnboarding: false,

    initApp: async () => {
      // Step 1: load identity as plain JSON (no encryption key needed yet)
      const rawIdentity = await storage.loadIdentity() as StoredIdentity | null

      // Guard: if stored data is from an old/incompatible format, wipe and re-onboard
      const isValid = rawIdentity
        && rawIdentity.userId
        && rawIdentity.keyPair
        && rawIdentity.keyPair.privateKeyJwk
        && rawIdentity.keyPair.publicKeyJwk
        && rawIdentity.keyPair.publicKeyHex

      if (!rawIdentity) {
        set({ isInitialized: true, isOnboarding: true })
        return
      }

      if (!isValid) {
        console.warn('[SafeChat] Incompatible stored identity detected, clearing data...')
        await storage.clearAll()
        set({ isInitialized: true, isOnboarding: true })
        return
      }

      if (isValid && rawIdentity) {
        // Step 2: derive storage key from the identity private key and activate it
        const storageKey = await deriveStorageKey(rawIdentity.keyPair.privateKeyJwk)
        storage.setStorageKey(storageKey)

        const keyPair = await deserializeKeyPair(rawIdentity.keyPair)
        const identity: RuntimeIdentity = { userId: rawIdentity.userId, displayName: rawIdentity.displayName, keyPair }

        const contacts = await storage.getContacts()
        const convMap = new Map<string, Conversation>()
        for (const c of contacts) {
          const messages = await storage.getMessages(c.id)
          convMap.set(c.id, {
            peerId: c.id, peerName: c.nickname, peerIdentityKey: c.identityKey,
            messages: messages as Message[], unread: 0, isOnline: false, isTyping: false,
            lastMessage: messages[messages.length - 1]?.content,
            lastTs: messages[messages.length - 1]?.ts,
          })
        }

        set({ identity, conversations: convMap, isInitialized: true, isOnboarding: false })
        connectNetwork(identity, get, set)
      }

      // Burn timer
      setInterval(async () => {
        await storage.burnExpiredMessages()
        const { conversations } = get()
        const now = Date.now()
        const newConvs = new Map(conversations)
        newConvs.forEach((conv, id) => {
          const msgs = conv.messages.map(m =>
            m.ttl && m.ttl < now && !m.burned ? { ...m, burned: true } : m
          )
          newConvs.set(id, { ...conv, messages: msgs })
        })
        set({ conversations: newConvs })
      }, 2000)
    },

    createIdentity: async (displayName: string) => {
      const keyPair = await generateIdentityKeyPair()
      const serialized = await serializeKeyPair(keyPair)
      const userId = generateUserId()

      const storageKey = await deriveStorageKey(serialized.privateKeyJwk)
      storage.setStorageKey(storageKey)

      const storedIdentity: StoredIdentity = { userId, displayName, keyPair: serialized }
      await storage.saveIdentity(storedIdentity)

      const identity: RuntimeIdentity = { userId, displayName, keyPair }
      set({ identity, isOnboarding: false, conversations: new Map() })
      connectNetwork(identity, get, set)
    },

    addContact: async (contactId, identityKeyHex, nickname) => {
      const contact: Contact = { id: contactId, nickname, identityKey: identityKeyHex, addedAt: Date.now() }
      await storage.saveContact(contact)
      const { conversations } = get()
      const newConvs = new Map(conversations)
      newConvs.set(contactId, {
        peerId: contactId, peerName: nickname, peerIdentityKey: identityKeyHex,
        messages: [], unread: 0, isOnline: false, isTyping: false,
      })
      set({ conversations: newConvs })
    },

    selectConversation: async (peerId) => {
      const { conversations } = get()
      const newConvs = new Map(conversations)
      const conv = newConvs.get(peerId)
      if (conv) newConvs.set(peerId, { ...conv, unread: 0 })
      set({ activeConversationId: peerId, conversations: newConvs })
      // Actively check online status when opening a conversation
      try {
        const result = await network.checkOnline([peerId])
        const isOnline = result[peerId] ?? false
        const c2 = get().conversations.get(peerId)
        if (c2) {
          const m2 = new Map(get().conversations)
          m2.set(peerId, { ...c2, isOnline })
          set({ conversations: m2 })
        }
      } catch {}
    },

    sendMessage: async (peerId, content, type = 'text', fileData, fileName, fileSize, fileMimeType) => {
      const { identity, conversations, defaultTtl } = get()
      if (!identity) return

      let session = sessionCache.get(peerId)
      const isFirst = !session

      if (!session) {
        const saved = await storage.loadSession(peerId) as SessionState | null
        if (saved) {
          session = deserializeSession(saved)
        } else {
          // Get peer's public key from their contact record
          const conv = conversations.get(peerId)
          if (!conv) return
          const { sendChainKey, recvChainKey, ephemeralKeyHex } = await deriveSessionAsSender(
            identity.keyPair, conv.peerIdentityKey
          )
          session = { sendChainKey, recvChainKey, sendIndex: 0, recvIndex: 0 }
          sessionCache.set(peerId, session)
          await storage.saveSession(peerId, serializeSession(session))

          // Attach x3dhInit to first message so recipient can derive session
          const ttl = defaultTtl ? Date.now() + defaultTtl : undefined
          const payload = JSON.stringify({ type, content, fileName, fileSize, fileMimeType, fileData, ttl })
          const { session: newSession, ciphertext, nonce } = await encryptMessage(session, encodeText(payload))
          sessionCache.set(peerId, newSession)
          await storage.saveSession(peerId, serializeSession(newSession))

          const envelope: EncryptedEnvelope = {
            ciphertext: Array.from(ciphertext), nonce: Array.from(nonce),
            messageIndex: 0, messageType: type,
            x3dhInit: { ephemeralKeyHex, senderIdentityKeyHex: toHex(identity.keyPair.publicKeyRaw) },
          }
          network.sendEncryptedMessage(peerId, envelope)

          const msg: Message = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            conversationId: peerId, senderId: identity.userId,
            type, content, fileName, fileSize, fileMimeType, fileData,
            ts: Date.now(), status: 'sent', ttl,
          }
          await storage.saveMessage(msg as StoredMessage)
          addMessageToConv(peerId, msg, get, set)
          return
        }
      }

      const ttl = defaultTtl ? Date.now() + defaultTtl : undefined
      const payload = JSON.stringify({ type, content, fileName, fileSize, fileMimeType, fileData, ttl })
      const { session: newSession, ciphertext, nonce } = await encryptMessage(session, encodeText(payload))
      sessionCache.set(peerId, newSession)
      await storage.saveSession(peerId, serializeSession(newSession))

      const envelope: EncryptedEnvelope = {
        ciphertext: Array.from(ciphertext), nonce: Array.from(nonce),
        messageIndex: newSession.sendIndex - 1, messageType: type,
      }
      network.sendEncryptedMessage(peerId, envelope)

      const msg: Message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        conversationId: peerId, senderId: identity.userId,
        type, content, fileName, fileSize, fileMimeType, fileData,
        ts: Date.now(), status: 'sent', ttl,
      }
      await storage.saveMessage(msg as StoredMessage)
      addMessageToConv(peerId, msg, get, set)
    },

    setDefaultTtl: (ttl) => set({ defaultTtl: ttl }),

    getQRData: () => {
      const { identity } = get()
      if (!identity) return ''
      return JSON.stringify({
        id: identity.userId,
        ik: toHex(identity.keyPair.publicKeyRaw),
        name: identity.displayName,
      })
    },
  }))
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addMessageToConv(peerId: string, msg: Message, get: () => AppState, set: (s: Partial<AppState>) => void) {
  const { conversations, activeConversationId } = get()
  const newConvs = new Map(conversations)
  const conv = newConvs.get(peerId)
  if (conv) {
    newConvs.set(peerId, {
      ...conv,
      messages: [...conv.messages, msg],
      lastMessage: msg.type === 'text' ? msg.content : `[${msg.type}]`,
      lastTs: msg.ts,
      unread: activeConversationId === peerId ? 0 : conv.unread + 1,
    })
    set({ conversations: newConvs })
  }
}

function connectNetwork(identity: RuntimeIdentity, get: () => AppState, set: (s: Partial<AppState>) => void) {
  network.connect(identity.userId, { identityKeyHex: toHex(identity.keyPair.publicKeyRaw) })

  network.onMessage = async (from, envelope, ts) => {
    let session = sessionCache.get(from)

    if (!session) {
      const saved = await storage.loadSession(from) as SessionState | null
      if (saved) {
        session = deserializeSession(saved)
      } else if (envelope.x3dhInit) {
        const { sendChainKey, recvChainKey } = await deriveSessionAsRecipient(
          identity.keyPair,
          envelope.x3dhInit.senderIdentityKeyHex,
          envelope.x3dhInit.ephemeralKeyHex
        )
        session = { sendChainKey, recvChainKey, sendIndex: 0, recvIndex: 0 }
        sessionCache.set(from, session)
        await storage.saveSession(from, serializeSession(session))
      } else {
        console.warn('No session and no x3dhInit from', from)
        return
      }
    }

    try {
      const { session: newSession, plaintext } = await decryptMessage(
        session,
        new Uint8Array(envelope.ciphertext),
        new Uint8Array(envelope.nonce)
      )
      sessionCache.set(from, newSession)
      await storage.saveSession(from, serializeSession(newSession))

      const payload = JSON.parse(decodeText(plaintext))
      const msg: Message = {
        id: `${ts}-${Math.random().toString(36).slice(2)}`,
        conversationId: from, senderId: from,
        type: payload.type || 'text', content: payload.content,
        fileName: payload.fileName, fileSize: payload.fileSize,
        fileMimeType: payload.fileMimeType, fileData: payload.fileData,
        ts, status: 'delivered', ttl: payload.ttl,
      }
      await storage.saveMessage(msg as StoredMessage)
      addMessageToConv(from, msg, get, set)
    } catch (e) {
      console.error('Decrypt failed:', e)
    }
  }

  network.onTyping = (from, isTyping) => {
    const newConvs = new Map(get().conversations)
    const conv = newConvs.get(from)
    if (conv) { newConvs.set(from, { ...conv, isTyping }); set({ conversations: newConvs }) }
  }

  network.onPresence = (userId, online) => {
    const newConvs = new Map(get().conversations)
    const conv = newConvs.get(userId)
    if (conv) { newConvs.set(userId, { ...conv, isOnline: online }); set({ conversations: newConvs }) }
  }
}

// ─── Session serialization (Uint8Array ↔ plain object) ───────────────────────

function serializeSession(s: SessionState): object {
  return {
    sendChainKey: Array.from(s.sendChainKey),
    recvChainKey: Array.from(s.recvChainKey),
    sendIndex: s.sendIndex,
    recvIndex: s.recvIndex,
  }
}

function deserializeSession(raw: unknown): SessionState {
  const r = raw as { sendChainKey: number[]; recvChainKey: number[]; sendIndex: number; recvIndex: number }
  return {
    sendChainKey: new Uint8Array(r.sendChainKey),
    recvChainKey: new Uint8Array(r.recvChainKey),
    sendIndex: r.sendIndex,
    recvIndex: r.recvIndex,
  }
}
