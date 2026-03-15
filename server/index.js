import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for file chunks
})

// In-memory only: userId -> socketId mapping
// Server NEVER stores messages, keys, or plaintext
const onlineUsers = new Map() // userId -> socketId
const pendingPreKeyBundles = new Map() // userId -> preKeyBundle (public keys only)

io.on('connection', (socket) => {
  let myUserId = null

  // --- Identity registration ---
  socket.on('register', ({ userId, preKeyBundle }) => {
    myUserId = userId
    onlineUsers.set(userId, socket.id)
    // Store only public key material for X3DH initiation
    pendingPreKeyBundles.set(userId, preKeyBundle)
    socket.join(userId)
    console.log(`[+] ${userId.slice(0, 8)} online (${onlineUsers.size} total)`)
  })

  // --- Fetch peer's pre-key bundle for X3DH ---
  socket.on('fetch_prekey_bundle', ({ targetUserId }, callback) => {
    const bundle = pendingPreKeyBundles.get(targetUserId)
    const online = onlineUsers.has(targetUserId)
    callback({ bundle: bundle || null, online })
  })

  // --- WebRTC signaling (server only relays, never reads) ---
  socket.on('signal', ({ to, payload }) => {
    io.to(to).emit('signal', { from: myUserId, payload })
  })

  // --- Encrypted message relay (server cannot decrypt) ---
  socket.on('message', ({ to, encryptedEnvelope }) => {
    const targetSocketId = onlineUsers.get(to)
    if (targetSocketId) {
      io.to(to).emit('message', {
        from: myUserId,
        encryptedEnvelope,
        ts: Date.now(),
      })
    }
    // If offline: message is dropped (Method A - pure P2P)
  })

  // --- Encrypted file chunk relay ---
  socket.on('file_chunk', ({ to, chunk }) => {
    io.to(to).emit('file_chunk', { from: myUserId, chunk })
  })

  // --- Typing indicator (no content) ---
  socket.on('typing', ({ to, isTyping }) => {
    io.to(to).emit('typing', { from: myUserId, isTyping })
  })

  // --- Online presence ---
  socket.on('check_online', ({ userIds }, callback) => {
    const result = {}
    userIds.forEach(id => { result[id] = onlineUsers.has(id) })
    callback(result)
  })

  socket.on('disconnect', () => {
    if (myUserId) {
      onlineUsers.delete(myUserId)
      pendingPreKeyBundles.delete(myUserId)
      io.emit('user_offline', { userId: myUserId })
      console.log(`[-] ${myUserId.slice(0, 8)} offline (${onlineUsers.size} total)`)
    }
  })
})

// Health check only - no data endpoints
app.get('/health', (_, res) => res.json({ status: 'ok', users: onlineUsers.size }))

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`SafeChat signal server running on :${PORT}`)
  console.log('Zero-knowledge relay: messages are never stored or read.')
})
