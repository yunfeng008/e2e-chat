import { io, Socket } from 'socket.io-client'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

export interface EncryptedEnvelope {
  ciphertext: number[]
  nonce: number[]
  messageIndex: number
  messageType: 'text' | 'image' | 'file' | 'system' | 'ack'
  x3dhInit?: {
    ephemeralKeyHex: string
    senderIdentityKeyHex: string
  }
}

type MessageHandler = (from: string, envelope: EncryptedEnvelope, ts: number) => void
type TypingHandler = (from: string, isTyping: boolean) => void
type PresenceHandler = (userId: string, online: boolean) => void

class NetworkManager {
  private socket: Socket | null = null
  private peers: Map<string, RTCPeerConnection> = new Map()
  private dataChannels: Map<string, RTCDataChannel> = new Map()

  onMessage: MessageHandler | null = null
  onTyping: TypingHandler | null = null
  onPresence: PresenceHandler | null = null

  connect(userId: string, preKeyBundle: object) {
    this.socket = io(SERVER_URL, { transports: ['websocket'] })

    this.socket.on('connect', () => {
      this.socket!.emit('register', { userId, preKeyBundle })
      console.log('[SafeChat] Connected to signal server')
    })

    this.socket.on('message', ({ from, encryptedEnvelope, ts }: { from: string; encryptedEnvelope: EncryptedEnvelope; ts: number }) => {
      this.onMessage?.(from, encryptedEnvelope, ts)
    })

    this.socket.on('typing', ({ from, isTyping }: { from: string; isTyping: boolean }) => {
      this.onTyping?.(from, isTyping)
    })

    this.socket.on('user_offline', ({ userId: uid }: { userId: string }) => {
      this.onPresence?.(uid, false)
    })

    this.socket.on('disconnect', () => {
      console.log('[SafeChat] Disconnected from signal server')
    })
  }

  sendEncryptedMessage(to: string, envelope: EncryptedEnvelope) {
    this.socket?.emit('message', { to, encryptedEnvelope: envelope })
  }

  sendTyping(to: string, isTyping: boolean) {
    this.socket?.emit('typing', { to, isTyping })
  }

  async fetchPreKeyBundle(targetUserId: string): Promise<{ bundle: object | null; online: boolean }> {
    return new Promise(resolve => {
      this.socket?.emit('fetch_prekey_bundle', { targetUserId }, resolve)
    })
  }

  async checkOnline(userIds: string[]): Promise<Record<string, boolean>> {
    return new Promise(resolve => {
      this.socket?.emit('check_online', { userIds }, resolve)
    })
  }

  disconnect() {
    this.socket?.disconnect()
    this.peers.forEach(pc => pc.close())
    this.peers.clear()
    this.dataChannels.clear()
  }
}

export const network = new NetworkManager()
