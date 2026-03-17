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

const onlineUsers = new Map()
const voiceRooms = new Map() // groupId -> Set<socketId>      // userId -> socketId
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

  // ── Group voice signaling ─────────────────────────────────────────────────
  // Server maintains voiceRooms: groupId → Set<socketId> for targeted broadcast

  // Broadcast helpers
  function broadcastToGroup(groupId, event, payload, excludeSocket) {
    const room = voiceRooms.get(groupId)
    if (!room) return
    for (const sid of room) {
      if (excludeSocket && sid === excludeSocket.id) continue
      io.to(sid).emit(event, payload)
    }
  }

  socket.on('voice_join', ({ groupId, fromName }) => {
    if (!voiceRooms.has(groupId)) voiceRooms.set(groupId, new Set())
    const room = voiceRooms.get(groupId)

    // Tell the newcomer who's already in the room (before adding them)
    const existingUserIds = []
    for (const [uid, sid] of onlineUsers.entries()) {
      if (room.has(sid) && uid !== myUserId) existingUserIds.push(uid)
    }
    if (existingUserIds.length > 0) {
      socket.emit('voice_room_members', { groupId, memberIds: existingUserIds })
    }

    room.add(socket.id)
    broadcastToGroup(groupId, 'voice_join', { from: myUserId, fromName, groupId }, socket)
  })

  socket.on('voice_leave', ({ groupId }) => {
    voiceRooms.get(groupId)?.delete(socket.id)
    if (voiceRooms.get(groupId)?.size === 0) voiceRooms.delete(groupId)
    // Broadcast to ALL online users — ex-members (who already left) also need this
    // to update their _activeRooms. Clients filter by groupId.
    socket.broadcast.emit('voice_leave', { from: myUserId, groupId })
  })

  // Broadcast: mute / hand / host transfer — to all in same group room
  socket.on('voice_mute',  ({ groupId, isMuted }) => broadcastToGroup(groupId, 'voice_mute',  { from: myUserId, isMuted, groupId }, socket))
  socket.on('voice_hand',  ({ groupId, isHandRaised }) => broadcastToGroup(groupId, 'voice_hand',  { from: myUserId, isHandRaised, groupId }, socket))
  socket.on('voice_host',  ({ groupId, newHostId }) => broadcastToGroup(groupId, 'voice_host_transfer', { newHostId, groupId }, socket))

  // Point-to-point: invite, reject, signal, force actions
  socket.on('voice_invite', ({ to, groupId, groupName, fromName }) => {
    io.to(to).emit('voice_invite', { from: myUserId, groupId, groupName, fromName })
  })
  socket.on('voice_reject', ({ to, groupId }) => {
    io.to(to).emit('voice_reject', { from: myUserId, groupId })
  })
  socket.on('voice_cancel', ({ to, groupId }) => {
    io.to(to).emit('voice_cancel', { from: myUserId, groupId })
  })
  socket.on('voice_signal', ({ to, groupId, payload }) => {
    io.to(to).emit('voice_signal', { from: myUserId, groupId, payload })
  })
  socket.on('voice_force_mute', ({ to, groupId }) => io.to(to).emit('voice_force_mute', { targetId: myUserId, groupId }))
  socket.on('voice_force_kick', ({ to, groupId }) => io.to(to).emit('voice_kick', { targetId: to, groupId }))

  // Clean up voice rooms on disconnect
  socket.on('disconnect', () => {
    for (const [groupId, sockets] of voiceRooms.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id)
        if (sockets.size === 0) voiceRooms.delete(groupId)
        socket.broadcast.emit('voice_leave', { from: myUserId, groupId })
        break
      }
    }
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
