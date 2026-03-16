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
import { voiceCall } from '../crypto/voiceCall'
import { groupVoice } from '../crypto/groupVoice'
import { groupVoice } from '../crypto/groupVoice'
import {
  generateGroupId, generateGroupKey,
  encryptGroupKeyForMember, decryptGroupKey,
  encryptGroupMessage, decryptGroupMessage,
  type GroupInfo, type GroupMember,
} from '../crypto/groupCrypto'

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
  mentions?: string[]  // userId[] who are @mentioned, includes 'all' for @all
}

export interface Conversation {
  peerId: string          // for group: groupId; for direct: userId
  peerName: string
  peerIdentityKey: string // for direct only
  type: 'direct' | 'group'
  groupInfo?: GroupInfo
  messages: Message[]
  unread: number
  mentionCount: number    // unread @mentions
  lastMessage?: string
  lastTs?: number
  isOnline: boolean
  isTyping: boolean
  kicked?: boolean  // true if local user was removed from this group
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
  createGroup: (name: string, memberIds: string[]) => Promise<void>
  inviteToGroup: (groupId: string, memberIds: string[]) => Promise<void>
  kickFromGroup: (groupId: string, memberId: string) => void
  dissolveGroup: (groupId: string) => void
}

// ─── Session cache ────────────────────────────────────────────────────────────

const sessionCache = new Map<string, SessionState>()

// ─── Group key cache ───────────────────────────────────────────────────────────

const groupKeyCache = new Map<string, Uint8Array>() // groupId -> raw AES key

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
        const now = Date.now()
        for (const c of contacts) {
          const messages = (await storage.getMessages(c.id)) as Message[]
          // Filter already-expired messages immediately on load
          const live = messages.filter(m => !m.ttl || m.ttl > now)
          if ((c as any).isGroup) {
            const gi = (c as any).groupInfo as GroupInfo
            convMap.set(c.id, {
              peerId: c.id, peerName: c.nickname, peerIdentityKey: '',
              type: 'group', groupInfo: gi, messages: live,
              unread: 0, mentionCount: 0, isOnline: true, isTyping: false,
              lastMessage: live[live.length - 1]?.content,
              lastTs: live[live.length - 1]?.ts,
            })
          } else {
            convMap.set(c.id, {
              peerId: c.id, peerName: c.nickname, peerIdentityKey: c.identityKey,
              type: 'direct', messages: live, unread: 0, mentionCount: 0, isOnline: false, isTyping: false,
              lastMessage: live[live.length - 1]?.content,
              lastTs: live[live.length - 1]?.ts,
            })
          }
        }

        // Restore group keys from encrypted storage
        try {
          const savedKeys = await storage.loadAllGroupKeys()
          for (const { id, key } of savedKeys) {
            groupKeyCache.set(id, key)
          }
        } catch (e) { console.warn('Failed to restore group keys:', e) }

        // Normalize all conversations - fill missing fields from old stored data
        convMap.forEach((conv, id) => {
          if (!conv.type) convMap.set(id, { ...conv, type: 'direct' })
          if (conv.mentionCount === undefined) convMap.set(id, { ...convMap.get(id)!, mentionCount: 0 })
        })

        set({ identity, conversations: convMap, isInitialized: true, isOnboarding: false })
        connectNetwork(identity, get, set)

        // Re-schedule burn timers for messages loaded from DB
        convMap.forEach((conv, peerId) => {
          conv.messages.forEach(msg => {
            if (msg.ttl) {
              const delay = msg.ttl - Date.now()
              if (delay <= 0) {
                burnMessage(msg.id, peerId, get, set)
              } else {
                setTimeout(() => burnMessage(msg.id, peerId, get, set), delay)
              }
            }
          })
        })
      }


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
        type: 'direct', messages: [], unread: 0, mentionCount: 0, isOnline: false, isTyping: false,
      })
      set({ conversations: newConvs })
    },

    selectConversation: async (peerId) => {
      const { conversations } = get()
      const newConvs = new Map(conversations)
      const conv = newConvs.get(peerId)
      if (conv) newConvs.set(peerId, { ...conv, unread: 0, mentionCount: 0 })
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

      const conv = conversations.get(peerId)

      // ── Group message ────────────────────────────────────────────────────
      if (conv?.type === 'group') {
        if (conv.kicked) return // silently block kicked members
        const groupKey = groupKeyCache.get(peerId)
        if (!groupKey) { console.error('No group key for', peerId); return }
        const ttl = defaultTtl ? Date.now() + defaultTtl : undefined
        // Extract @mentions from content
        const members = conv.groupInfo?.members ?? []
        const mentions: string[] = []
        const mentionRegex = /@(\S+)/g
        let m
        while ((m = mentionRegex.exec(content)) !== null) {
          if (m[1].toLowerCase() === 'all') {
            mentions.push('all')
          } else {
            const found = members.find(mb => mb.displayName === m[1])
            if (found) mentions.push(found.userId)
          }
        }
        const payload = JSON.stringify({ type, content, fileName, fileSize, fileMimeType, fileData, ttl, mentions })
        const { ciphertext, nonce } = await encryptGroupMessage(groupKey, new TextEncoder().encode(payload))
        for (const m of members) {
          if (m.userId === identity.userId) continue
          network.sendEncryptedMessage(m.userId, {
            ciphertext, nonce, messageIndex: 0, messageType: type,
            groupId: peerId,
          } as any)
        }
        const msg: Message = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          conversationId: peerId, senderId: identity.userId,
          type, content, fileName, fileSize, fileMimeType, fileData,
          ts: Date.now(), status: 'sent', ttl, mentions,
        }
        await storage.saveMessage(msg as StoredMessage)
        addMessageToConv(peerId, msg, get, set)
        return
      }

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

    createGroup: async (name, memberIds) => {
      const { identity, conversations } = get()
      if (!identity) return

      const groupId = generateGroupId()
      const groupKey = await generateGroupKey()
      groupKeyCache.set(groupId, groupKey)
      await storage.saveGroupKey(groupId, groupKey)

      // Build member list including self
      const members: GroupMember[] = [{
        userId: identity.userId,
        displayName: identity.displayName,
        identityKeyHex: toHex(identity.keyPair.publicKeyRaw),
      }]
      for (const id of memberIds) {
        const conv = conversations.get(id)
        if (conv && conv.type === 'direct') {
          members.push({ userId: id, displayName: conv.peerName, identityKeyHex: conv.peerIdentityKey })
        }
      }

      const groupInfo: GroupInfo = { id: groupId, name, creatorId: identity.userId, members, createdAt: Date.now() }

      // Encrypt group key for each member and send via existing message channel
      for (const member of members) {
        if (member.userId === identity.userId) continue
        const encKey = await encryptGroupKeyForMember(
          groupKey, identity.keyPair.privateKey, member.identityKeyHex
        )
        // Use the existing sendEncryptedMessage - put groupInit as extra field
        ;(network as any).sendGroupInit(member.userId, {
          ciphertext: encKey.encryptedKey,
          nonce: encKey.nonce,
          messageIndex: 0,
          messageType: 'system',
          groupInit: {
            groupId,
            groupName: name,
            members,
            senderIdentityKeyHex: toHex(identity.keyPair.publicKeyRaw),
          },
        })
      }

      await storage.saveContact({ id: groupId, nickname: name, identityKey: '', addedAt: Date.now(), isGroup: true, groupInfo } as any)
      const newConvs = new Map(conversations)
      newConvs.set(groupId, {
        peerId: groupId, peerName: name, peerIdentityKey: '',
        type: 'group', groupInfo, messages: [], unread: 0, mentionCount: 0, isOnline: true, isTyping: false,
      })
      set({ conversations: newConvs, activeConversationId: groupId })
    },

    inviteToGroup: async (groupId, memberIds) => {
      const { identity, conversations } = get()
      if (!identity) return
      const conv = conversations.get(groupId)
      if (!conv || conv.type !== 'group' || conv.kicked) return
      const groupKey = groupKeyCache.get(groupId)
      if (!groupKey) { console.error('No group key for', groupId); return }

      const existingMembers = conv.groupInfo?.members ?? []
      const newMembers: GroupMember[] = []

      // Collect new members info and send them the encrypted group key
      for (const id of memberIds) {
        const c = conversations.get(id)
        if (!c || c.type !== 'direct') continue
        // Skip if already a member
        if (existingMembers.find(m => m.userId === id)) continue

        const encKey = await encryptGroupKeyForMember(groupKey, identity.keyPair.privateKey, c.peerIdentityKey)
        const newMember: GroupMember = { userId: id, displayName: c.peerName, identityKeyHex: c.peerIdentityKey }
        newMembers.push(newMember)

        const updatedMembers = [...existingMembers, ...newMembers]
        ;(network as any).sendGroupInit(id, {
          ciphertext: encKey.encryptedKey, nonce: encKey.nonce,
          messageIndex: 0, messageType: 'system',
          groupInit: {
            groupId, groupName: conv.peerName,
            members: updatedMembers,
            senderIdentityKeyHex: toHex(identity.keyPair.publicKeyRaw),
          },
        })
      }

      if (newMembers.length === 0) return

      // Update group member list locally
      const updatedMembers = [...existingMembers, ...newMembers]
      const newGroupInfo = { ...conv.groupInfo!, members: updatedMembers }
      const newConvs = new Map(get().conversations)
      newConvs.set(groupId, { ...conv, groupInfo: newGroupInfo })
      set({ conversations: newConvs })
      await storage.saveContact({ id: groupId, nickname: conv.peerName, identityKey: '', addedAt: Date.now(), isGroup: true, groupInfo: newGroupInfo } as any)

      // Notify existing members about the new members
      for (const m of existingMembers) {
        if (m.userId === identity.userId) continue
        ;(network as any).sendGroupInit(m.userId, {
          ciphertext: [], nonce: [], messageIndex: 0, messageType: 'system',
          groupUpdate: { groupId, members: updatedMembers },
        })
      }
    },

    kickFromGroup: (groupId, memberId) => {
      const { identity, conversations } = get()
      if (!identity) return
      const conv = conversations.get(groupId)
      if (!conv || conv.type !== 'group') return
      if (conv.groupInfo?.creatorId !== identity.userId) return // only creator can kick

      const newMembers = (conv.groupInfo.members ?? []).filter(m => m.userId !== memberId)
      const newGroupInfo = { ...conv.groupInfo, members: newMembers }

      // Notify all remaining members about the kick (so they update member list)
      for (const m of newMembers) {
        if (m.userId === identity.userId) continue
        network.sendGroupInit(m.userId, {
          ciphertext: [], nonce: [], messageIndex: 0, messageType: 'system',
          groupUpdate: { groupId, members: newMembers },
        })
      }
      // Notify kicked member
      network.sendGroupInit(memberId, {
        ciphertext: [], nonce: [], messageIndex: 0, messageType: 'system',
        groupKick: { groupId },
      })

      const newConvs = new Map(conversations)
      newConvs.set(groupId, { ...conv, groupInfo: newGroupInfo })
      set({ conversations: newConvs })

      // Persist updated group info
      storage.saveContact({ id: groupId, nickname: conv.peerName, identityKey: '', addedAt: Date.now(), isGroup: true, groupInfo: newGroupInfo } as any)
    },

    dissolveGroup: (groupId) => {
      const { identity, conversations } = get()
      if (!identity) return
      const conv = conversations.get(groupId)
      if (!conv || conv.type !== 'group') return
      if (conv.groupInfo?.creatorId !== identity.userId) return

      // Notify all members the group is dissolved
      const members = conv.groupInfo?.members ?? []
      for (const m of members) {
        if (m.userId === identity.userId) continue
        ;(network as any).sendGroupInit(m.userId, {
          ciphertext: [], nonce: [], messageIndex: 0, messageType: 'system',
          groupDissolve: { groupId },
        })
      }

      // Remove locally
      const newConvs = new Map(get().conversations)
      newConvs.delete(groupId)
      set({ conversations: newConvs, activeConversationId: null })
      storage.saveContact({ id: groupId, nickname: conv.peerName, identityKey: '', addedAt: 0, isGroup: true, dissolved: true } as any)
    },

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
  const { conversations, activeConversationId, identity } = get()
  const newConvs = new Map(conversations)
  const conv = newConvs.get(peerId)
  if (conv) {
    const isActive = activeConversationId === peerId
    const isMentioned = !isActive && msg.senderId !== identity?.userId && (
      msg.mentions?.includes(identity?.userId ?? '') ||
      msg.mentions?.includes('all')
    )
    newConvs.set(peerId, {
      ...conv,
      messages: [...conv.messages, msg],
      lastMessage: msg.type === 'text' ? msg.content : `[${msg.type}]`,
      lastTs: msg.ts,
      unread: isActive ? 0 : conv.unread + 1,
      mentionCount: isActive ? 0 : conv.mentionCount + (isMentioned ? 1 : 0),
    })
    set({ conversations: newConvs })
  }

  // Schedule precise burn for this message
  if (msg.ttl) {
    const delay = msg.ttl - Date.now()
    if (delay <= 0) {
      burnMessage(msg.id, peerId, get, set)
    } else {
      setTimeout(() => burnMessage(msg.id, peerId, get, set), delay)
    }
  }
}

function burnMessage(msgId: string, peerId: string, get: () => AppState, set: (s: Partial<AppState>) => void) {
  storage.burnMessage(msgId)
  const { conversations } = get()
  const conv = conversations.get(peerId)
  if (!conv) return
  const filtered = conv.messages.filter(m => m.id !== msgId)
  if (filtered.length === conv.messages.length) return // already gone
  const last = filtered[filtered.length - 1]
  const newConvs = new Map(conversations)
  newConvs.set(peerId, {
    ...conv,
    messages: filtered,
    mentionCount: conv.mentionCount ?? 0,
    lastMessage: last ? (last.type === 'text' ? last.content : `[${last.type}]`) : undefined,
    lastTs: last?.ts,
  })
  set({ conversations: newConvs })
}

function connectNetwork(identity: RuntimeIdentity, get: () => AppState, set: (s: Partial<AppState>) => void) {
  network.connect(identity.userId, { identityKeyHex: toHex(identity.keyPair.publicKeyRaw) })
  // Inject socket into voiceCall once it's connected
  network.onSocketReady = (socket) => { voiceCall.setSocket(socket); groupVoice.setSocket(socket) }

  network.onMessage = async (from, envelope, ts) => {
    // ── Group init (key distribution) ─────────────────────────────────────
    const env = envelope as any
    // ── Group member update (kick/add) ───────────────────────────────────
    if (env.groupDissolve) {
      const { groupId } = env.groupDissolve
      const newConvs = new Map(get().conversations)
      newConvs.delete(groupId)
      const currentActive = get().activeConversationId
      set({
        conversations: newConvs,
        activeConversationId: currentActive === groupId ? null : currentActive,
      })
      return
    }

    if (env.groupUpdate) {
      const { groupId, members } = env.groupUpdate
      const { conversations } = get()
      const conv = conversations.get(groupId)
      if (conv && conv.type === 'group' && conv.groupInfo) {
        const newGroupInfo = { ...conv.groupInfo, members }
        const newConvs = new Map(get().conversations)
        newConvs.set(groupId, { ...conv, groupInfo: newGroupInfo })
        set({ conversations: newConvs })
        await storage.saveContact({ id: groupId, nickname: conv.peerName, identityKey: '', addedAt: Date.now(), isGroup: true, groupInfo: newGroupInfo } as any)
      }
      return
    }
    if (env.groupKick) {
      const { groupId } = env.groupKick
      const newConvs = new Map(get().conversations)
      const conv = newConvs.get(groupId)
      if (conv) {
        const kickMsg: Message = {
          id: `${ts}-kick`, conversationId: groupId, senderId: from,
          type: 'system', content: '你已被移出群聊', ts, status: 'delivered',
        }
        newConvs.set(groupId, { ...conv, kicked: true, messages: [...conv.messages, kickMsg] })
        set({ conversations: newConvs })
      }
      return
    }

    if (env.groupInit) {
      const { groupId, groupName, members, senderIdentityKeyHex } = env.groupInit
      if (!groupKeyCache.has(groupId)) {
        try {
          const rawKey = await decryptGroupKey(
            envelope.ciphertext, envelope.nonce,
            identity.keyPair.privateKey, senderIdentityKeyHex
          )
          groupKeyCache.set(groupId, rawKey)
          await storage.saveGroupKey(groupId, rawKey)
        } catch { return }
      }
      // Create or update group conversation
      const { conversations } = get()
      const groupInfo: GroupInfo = { id: groupId, name: groupName, creatorId: from, members, createdAt: ts }
      if (!conversations.has(groupId)) {
        // Brand new group
        await storage.saveContact({ id: groupId, nickname: groupName, identityKey: '', addedAt: ts, isGroup: true, groupInfo } as any)
        const newConvs = new Map(get().conversations)
        newConvs.set(groupId, {
          peerId: groupId, peerName: groupName, peerIdentityKey: '',
          type: 'group', groupInfo, messages: [], unread: 0, mentionCount: 0, isOnline: true, isTyping: false,
        })
        set({ conversations: newConvs })
      } else {
        // Already in group — update member list AND clear kicked flag if re-invited
        const existing = conversations.get(groupId)!
        const updatedGroupInfo = { ...existing.groupInfo!, members }
        const newConvs = new Map(get().conversations)
        newConvs.set(groupId, { ...existing, groupInfo: updatedGroupInfo, kicked: false })
        set({ conversations: newConvs })
        await storage.saveContact({ id: groupId, nickname: groupName, identityKey: '', addedAt: ts, isGroup: true, groupInfo: updatedGroupInfo } as any)
      }
      return
    }

    // ── Group message ──────────────────────────────────────────────────────
    if (env.groupId) {
      const groupKey = groupKeyCache.get(env.groupId)
      if (!groupKey) return
      try {
        const plaintext = await decryptGroupMessage(groupKey, envelope.ciphertext, envelope.nonce)
        const payload = JSON.parse(decodeText(plaintext))
        const msg: Message = {
          id: `${ts}-${Math.random().toString(36).slice(2)}`,
          conversationId: env.groupId, senderId: from,
          type: payload.type || 'text', content: payload.content,
          fileName: payload.fileName, fileSize: payload.fileSize,
          fileMimeType: payload.fileMimeType, fileData: payload.fileData,
          ts, status: 'delivered', ttl: payload.ttl,
          mentions: payload.mentions,
        }
        await storage.saveMessage(msg as StoredMessage)
        addMessageToConv(env.groupId, msg, get, set)
      } catch (e) { console.error('group decrypt failed:', e) }
      return
    }

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
        ts, status: 'delivered',
        // ttl: sender sends absolute expiry; recipient resets clock from time of receipt
        ttl: payload.ttl ? Date.now() + (payload.ttl - ts) : undefined,
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
