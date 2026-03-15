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
  maxHttpBufferSize: 50 * 1024 * 1024,
})

const onlineUsers = new Map()      // userId -> socketId
const preKeyBundles = new Map()    // userId -> preKeyBundle

io.on('connection', (socket) => {
  let myUserId = null

  socket.on('register', ({ userId, preKeyBundle }) => {
    myUserId = userId
    onlineUsers.set(userId, socket.id)
    preKeyBundles.set(userId, preKeyBundle)
    socket.join(userId)
    // Broadcast to everyone that this user is now online
    socket.broadcast.emit('user_online', { userId })
    console.log(`[+] ${userId.slice(0, 8)} online (${onlineUsers.size} total)`)
  })

  socket.on('fetch_prekey_bundle', ({ targetUserId }, callback) => {
    callback({
      bundle: preKeyBundles.get(targetUserId) || null,
      online: onlineUsers.has(targetUserId),
    })
  })

  // Check online status of multiple users at once
  socket.on('check_online', ({ userIds }, callback) => {
    const result = {}
    userIds.forEach(id => { result[id] = onlineUsers.has(id) })
    callback(result)
  })

  socket.on('signal', ({ to, payload }) => {
    io.to(to).emit('signal', { from: myUserId, payload })
  })

  socket.on('message', ({ to, encryptedEnvelope }) => {
    if (onlineUsers.has(to)) {
      io.to(to).emit('message', { from: myUserId, encryptedEnvelope, ts: Date.now() })
    }
  })

  // Group message broadcast: client sends to each member individually,
  // server just relays. groupId is inside encryptedEnvelope (opaque to server).
  socket.on('group_message', ({ members, encryptedEnvelope }) => {
    const ts = Date.now()
    for (const memberId of members) {
      if (memberId !== myUserId && onlineUsers.has(memberId)) {
        io.to(memberId).emit('message', { from: myUserId, encryptedEnvelope, ts })
      }
    }
  })

  socket.on('typing', ({ to, isTyping }) => {
    io.to(to).emit('typing', { from: myUserId, isTyping })
  })

  // Voice call signaling relay (server never touches audio)
  socket.on('call_offer',  ({ to, fromName, sdp })  => io.to(to).emit('call_offer',  { from: myUserId, fromName, sdp }))
  socket.on('call_answer', ({ to, sdp })            => io.to(to).emit('call_answer', { from: myUserId, sdp }))
  socket.on('call_ice',    ({ to, candidate })      => io.to(to).emit('call_ice',    { from: myUserId, candidate }))
  socket.on('call_reject', ({ to, reason })         => io.to(to).emit('call_reject', { from: myUserId, reason }))
  socket.on('call_hangup', ({ to })                 => io.to(to).emit('call_hangup', { from: myUserId }))

  socket.on('disconnect', () => {
    if (myUserId) {
      onlineUsers.delete(myUserId)
      preKeyBundles.delete(myUserId)
      socket.broadcast.emit('user_offline', { userId: myUserId })
      console.log(`[-] ${myUserId.slice(0, 8)} offline (${onlineUsers.size} total)`)
    }
  })
})

app.get('/health', (_, res) => res.json({ status: 'ok', users: onlineUsers.size }))

const PORT = process.env.PORT || 3001
httpServer.listen(PORT, () => {
  console.log(`SafeChat signal server :${PORT}`)
})
