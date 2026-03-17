/**
 * GroupVoiceManager — Mesh P2P 群语音
 * 每个成员与其他所有人建立独立的 WebRTC 连接
 * 信令复用现有 Socket.io，音频 DTLS-SRTP 端对端加密
 */

export interface VoiceMember {
  userId: string
  displayName: string
  isMuted: boolean
  isHandRaised: boolean
  isSpeaking: boolean
  handTimer?: number  // 剩余秒数
  isHost: boolean     // 是否主持人
}

export interface VoiceRoomState {
  groupId: string
  groupName: string
  members: VoiceMember[]
  myUserId: string
  isMuted: boolean
  isHandRaised: boolean
  handTimer: number   // 倒计时剩余秒数，0=未激活
  hostId: string
  minimized: boolean
}

type StateHandler = (state: VoiceRoomState | null) => void

class GroupVoiceManager {
  private _state: VoiceRoomState | null = null
  // Track which groups have active voice rooms (groupId -> member who started)
  private _activeRooms = new Map<string, string>() // groupId -> initiatorName
  private _roomMemberCounts = new Map<string, Set<string>>() // groupId -> Set of userIds
  private _pendingInvites = new Map<string, Set<string>>() // groupId -> Set of invited userIds not yet responded
  // Multi-listener callbacks — use arrays so multiple components can subscribe
  private _onRoomActivityListeners: ((groupId: string, active: boolean, initiatorName?: string) => void)[] = []
  onInvite: ((groupId: string, groupName: string, fromUserId: string, fromName: string) => void) | null = null
  onInviteCancel: ((groupId: string) => void) | null = null

  // Compatibility shim: set onRoomActivity still works, but now supports multiple listeners
  set onRoomActivity(fn: ((groupId: string, active: boolean, initiatorName?: string) => void) | null) {
    // Replace the last registered listener (keeps backward compat with single-set pattern)
    if (fn) {
      if (this._onRoomActivityListeners.length > 0) this._onRoomActivityListeners[this._onRoomActivityListeners.length - 1] = fn
      else this._onRoomActivityListeners.push(fn)
    } else {
      if (this._onRoomActivityListeners.length > 0) this._onRoomActivityListeners.pop()
    }
  }
  addRoomActivityListener(fn: (groupId: string, active: boolean, initiatorName?: string) => void) {
    this._onRoomActivityListeners.push(fn)
    return () => { this._onRoomActivityListeners = this._onRoomActivityListeners.filter(l => l !== fn) }
  }
  private _pendingReceivedInvites = new Set<string>() // groupIds we were invited to but haven't accepted/rejected
  private _socket: unknown = null
  private _pcs = new Map<string, RTCPeerConnection>()      // userId → PC
  private _audioEls = new Map<string, HTMLAudioElement>()  // userId → audio
  private _localStream: MediaStream | null = null
  private _handInterval: ReturnType<typeof setInterval> | null = null
  private _myName = ''
  private _groupMembers: { userId: string; displayName: string }[] = []

  onStateChange: StateHandler | null = null

  setSocket(socket: unknown) { this._socket = socket; this._bindSignaling() }

  private _emit(event: string, data: unknown) {
    (this._socket as { emit: (e: string, d: unknown) => void } | null)?.emit(event, data)
  }

  private _bindSignaling() {
    const s = this._socket as { on: (e: string, cb: (d: unknown) => void) => void }

    // Someone joined the room — add to member list and establish WebRTC
    s.on('voice_join', async (data: unknown) => {
      const { from, fromName, groupId } = data as { from: string; fromName: string; groupId: string }

      // Track active rooms regardless of whether we're in this one
      if (!this._roomMemberCounts.has(groupId)) this._roomMemberCounts.set(groupId, new Set())
      this._roomMemberCounts.get(groupId)!.add(from)
      if (!this._activeRooms.has(groupId)) {
        this._activeRooms.set(groupId, fromName)
        this._onRoomActivityListeners.forEach(l => l(groupId, true, fromName))
      }
      // They accepted — remove from pending
      this._pendingInvites.get(groupId)?.delete(from)

      // Only act if we're in this room
      if (!this._state || this._state.groupId !== groupId) return
      if (this._state.members.find(m => m.userId === from)) return

      this._addMember(from, fromName, false)
      // We are the existing member — initiate WebRTC offer to the newcomer
      await this._connectTo(from, true)
    })

    s.on('voice_leave', (data: unknown) => {
      const { from, groupId } = data as { from: string; groupId: string }

      // Update room count regardless of local state
      const members = this._roomMemberCounts.get(groupId)
      if (members) {
        members.delete(from)
        if (members.size === 0) {
          this._activeRooms.delete(groupId)
          this._roomMemberCounts.delete(groupId)
        }
      }
      // Always notify listeners so button re-renders even for ex-members
      this._onRoomActivityListeners.forEach(l => l(groupId, this._activeRooms.has(groupId)))
      if (this._state?.groupId === groupId) this._removeMember(from)
    })

    s.on('voice_mute', (data: unknown) => {
      const { from, isMuted, groupId } = data as { from: string; isMuted: boolean; groupId: string }
      if (this._state?.groupId !== groupId) return
      this._updateMember(from, { isMuted })
    })

    s.on('voice_hand', (data: unknown) => {
      const { from, isHandRaised, groupId } = data as { from: string; isHandRaised: boolean; groupId: string }
      if (this._state?.groupId !== groupId) return
      this._updateMember(from, { isHandRaised })
    })

    s.on('voice_host_transfer', (data: unknown) => {
      const { newHostId, groupId } = data as { newHostId: string; groupId: string }
      if (this._state?.groupId !== groupId) return
      this._state = { ...this._state, hostId: newHostId,
        members: this._state.members.map(m => ({ ...m, isHost: m.userId === newHostId })) }
      this._notify()
    })

    // Host forced us muted
    s.on('voice_force_mute', (data: unknown) => {
      const { groupId } = data as { groupId: string }
      if (this._state?.groupId !== groupId) return
      this._applyMute(true)
    })

    // Host kicked us out
    s.on('voice_kick', (data: unknown) => {
      const { targetId, groupId } = data as { targetId: string; groupId: string }
      if (this._state?.groupId !== groupId) return
      if (targetId === this._state.myUserId) this.leaveRoom()
      else this._removeMember(targetId)
    })

    // Inviter cancelled (hung up before we accepted) — dismiss banner
    s.on('voice_cancel', (data: unknown) => {
      const { groupId } = data as { groupId: string }
      this._pendingReceivedInvites.delete(groupId)
      // Inviter cancelled — room is gone, clear active room state
      this._activeRooms.delete(groupId)
      this._roomMemberCounts.delete(groupId)
      this._onRoomActivityListeners.forEach(l => l(groupId, false))
      this.onInviteCancel?.(groupId)
    })

    // Incoming invite — mark room active immediately (don't wait for voice_join broadcast)
    s.on('voice_invite', (data: unknown) => {
      const { from, groupId, groupName, fromName } = data as { from: string; groupId: string; groupName: string; fromName: string }
      this._pendingReceivedInvites.add(groupId)
      // Pre-mark as active room so button shows "join" not "start" even before voice_join arrives
      if (!this._activeRooms.has(groupId)) {
        this._activeRooms.set(groupId, fromName)
        if (!this._roomMemberCounts.has(groupId)) this._roomMemberCounts.set(groupId, new Set())
        this._roomMemberCounts.get(groupId)!.add(from) // count the inviter
        this._onRoomActivityListeners.forEach(l => l(groupId, true, fromName))
      }
      this.onInvite?.(groupId, groupName, from, fromName)
    })

    // Someone rejected our invite (point-to-point, server sends only to us)
    s.on('voice_reject', (data: unknown) => {
      const { from, groupId } = data as { from: string; groupId: string }
      if (this._state?.groupId !== groupId) return
      const pending = this._pendingInvites.get(groupId)
      if (!pending) return
      pending.delete(from)
      if (pending.size === 0 && this._state.members.length <= 1) {
        this.leaveRoom()
      }
    })

    // Server tells us who's already in the room when we join
    s.on('voice_room_members', async (data: unknown) => {
      const { groupId, memberIds } = data as { groupId: string; memberIds: string[] }
      if (this._state?.groupId !== groupId) return
      for (const uid of memberIds) {
        if (this._state.members.find(m => m.userId === uid)) continue
        const displayName = this._groupMembers.find(m => m.userId === uid)?.displayName ?? uid.slice(0, 8)
        this._addMember(uid, displayName, false)
        // Don't initiate — let the existing member send the offer (they receive our voice_join)
      }
    })

    // WebRTC SDP/ICE (point-to-point)
    s.on('voice_signal', async (data: unknown) => {
      const { from, payload, groupId } = data as { from: string; payload: RTCSessionDescriptionInit | { type: 'candidate'; candidate: RTCIceCandidateInit }; groupId: string }
      if (this._state?.groupId !== groupId) return
      await this._handleSignal(from, payload)
    })
  }

  // ── Join / Leave ────────────────────────────────────────────────────────────

  async joinRoom(groupId: string, groupName: string, myUserId: string, myName: string, hostId: string, groupMembers: { userId: string; displayName: string }[], inviteList?: string[]) {
    if (this._state) return

    this._myName = myName
    this._groupMembers = groupMembers
    this._pendingReceivedInvites.delete(groupId) // cleared: we're joining
    this._localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this._localStream.getAudioTracks().forEach(t => { t.enabled = true })

    this._state = {
      groupId, groupName, myUserId, hostId, minimized: false,
      isMuted: false, isHandRaised: false, handTimer: 0,
      members: [{ userId: myUserId, displayName: myName, isMuted: false, isHandRaised: false, isSpeaking: false, isHost: myUserId === hostId }],
    }
    this._notify()

    // Broadcast join
    this._activeRooms.set(groupId, myName)
    if (!this._roomMemberCounts.has(groupId)) this._roomMemberCounts.set(groupId, new Set())
    this._roomMemberCounts.get(groupId)!.add(myUserId)

    // Broadcast that we joined — server routes to all in this group's voice room
    this._emit('voice_join', { groupId, fromName: myName })

    // Send point-to-point invites to selected members
    if (inviteList && inviteList.length > 0) {
      this._pendingInvites.set(groupId, new Set(inviteList))
      for (const userId of inviteList) {
        this._emit('voice_invite', { to: userId, groupId, groupName, fromName: myName })
      }
    }

    // Do NOT pre-fill existingMembers — they appear only when they send voice_join back
  }

  leaveRoom() {
    if (!this._state) return
    const { groupId, myUserId } = this._state
    // Cancel pending invites — notify invitees so they can dismiss their banners
    const pending = this._pendingInvites.get(groupId)
    if (pending && pending.size > 0) {
      for (const userId of pending) {
        this._emit('voice_cancel', { to: userId, groupId })
      }
    }
    this._emit('voice_leave', { groupId })
    // Remove self from room count
    const rm = this._roomMemberCounts.get(groupId)
    if (rm) {
      rm.delete(myUserId)
      if (rm.size === 0) {
        // Room is now empty — clear everything
        this._activeRooms.delete(groupId)
        this._roomMemberCounts.delete(groupId)
        this._onRoomActivityListeners.forEach(l => l(groupId, false))
      }
      // If others remain, keep _activeRooms so the button stays green for re-joining
    } else {
      // No count tracked — safe to clear
      this._activeRooms.delete(groupId)
      this._onRoomActivityListeners.forEach(l => l(groupId, false))
    }
    this._pendingInvites.delete(groupId)
    this._cleanup()
    this._notify()
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  toggleMute() {
    if (!this._state || !this._localStream) return
    const next = !this._state.isMuted
    // If hand raised (speaking window), can't mute
    if (this._state.handTimer > 0 && next) return
    this._applyMute(next)
    this._emit('voice_mute', { groupId: this._state.groupId, isMuted: next })
  }

  raiseHand() {
    if (!this._state) return
    if (this._state.handTimer > 0) {
      // Cancel hand raise
      this._stopHandTimer()
      return
    }

    // Start 60s speaking window
    this._applyMute(false)
    this._state = { ...this._state, isHandRaised: true, handTimer: 60 }
    this._updateMember(this._state.myUserId, { isHandRaised: true })
    this._notify()

    this._emit('voice_hand', { groupId: this._state.groupId, isHandRaised: true })

    this._handInterval = setInterval(() => {
      if (!this._state) { this._stopHandTimer(); return }
      const remaining = this._state.handTimer - 1
      if (remaining <= 0) {
        this._stopHandTimer()
        this._applyMute(true)
        this._emit('voice_mute', { groupId: this._state.groupId, isMuted: true })
      } else {
        this._state = { ...this._state, handTimer: remaining }
        this._notify()
      }
    }, 1000)
  }

  private _stopHandTimer() {
    if (this._handInterval) { clearInterval(this._handInterval); this._handInterval = null }
    if (!this._state) return
    this._state = { ...this._state, isHandRaised: false, handTimer: 0 }
    this._updateMember(this._state.myUserId, { isHandRaised: false })
    this._notify()
    this._emit('voice_hand', { groupId: this._state.groupId, isHandRaised: false })
  }

  // Host actions
  forceMute(targetId: string) {
    if (!this._state || this._state.hostId !== this._state.myUserId) return
    this._emit('voice_force_mute', { to: targetId, groupId: this._state.groupId })
    this._updateMember(targetId, { isMuted: true })
  }

  kickFromVoice(targetId: string) {
    if (!this._state || this._state.hostId !== this._state.myUserId) return
    this._emit('voice_force_kick', { to: targetId, groupId: this._state.groupId })
    this._removeMember(targetId)
  }

  transferHost(targetId: string) {
    if (!this._state || this._state.hostId !== this._state.myUserId) return
    this._emit('voice_host', { groupId: this._state.groupId, newHostId: targetId })
    this._state = { ...this._state, hostId: targetId }
    this._state.members = this._state.members.map(m => ({ ...m, isHost: m.userId === targetId }))
    this._notify()
  }

  setMinimized(v: boolean) {
    if (!this._state) return
    this._state = { ...this._state, minimized: v }
    this._notify()
  }

  getState() { return this._state }
  isRoomActive(groupId: string) { return this._activeRooms.has(groupId) }
  getRoomInitiator(groupId: string) { return this._activeRooms.get(groupId) }
  hasPendingInvite(groupId: string) { return this._pendingReceivedInvites.has(groupId) }

  sendReject(groupId: string, _myUserId: string, toUserId: string) {
    this._pendingReceivedInvites.delete(groupId)
    this._emit('voice_reject', { to: toUserId, groupId })
  }

  // ── WebRTC ──────────────────────────────────────────────────────────────────

  private async _connectTo(peerId: string, isInitiator: boolean) {
    if (this._pcs.has(peerId)) return
    const pc = this._createPC(peerId)

    if (isInitiator) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this._emitSignal(peerId, offer)
    }
  }

  private _createPC(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [] })
    this._pcs.set(peerId, pc)

    this._localStream?.getTracks().forEach(t => pc.addTrack(t, this._localStream!))

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this._emitSignal(peerId, { type: 'candidate', candidate: candidate.toJSON() })
    }

    pc.ontrack = ({ streams }) => {
      let audio = this._audioEls.get(peerId)
      if (!audio) {
        audio = new Audio()
        audio.autoplay = true
        this._audioEls.set(peerId, audio)
      }
      if (streams[0]) audio.srcObject = streams[0]
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this._removeMember(peerId)
      }
    }

    return pc
  }

  private async _handleSignal(from: string, payload: RTCSessionDescriptionInit | { type: 'candidate'; candidate: RTCIceCandidateInit }) {
    let pc = this._pcs.get(from)
    if (!pc) { pc = this._createPC(from) }

    if (payload.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      this._emitSignal(from, answer)
    } else if (payload.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload as RTCSessionDescriptionInit))
    } else if (payload.type === 'candidate') {
      const { candidate } = payload as { type: 'candidate'; candidate: RTCIceCandidateInit }
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
  }

  private _emitSignal(to: string, payload: unknown) {
    if (!this._state) return
    this._emit('voice_signal', { to, groupId: this._state.groupId, payload })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _applyMute(muted: boolean) {
    this._localStream?.getAudioTracks().forEach(t => { t.enabled = !muted })
    if (!this._state) return
    this._state = { ...this._state, isMuted: muted }
    this._updateMember(this._state.myUserId, { isMuted: muted })
    this._notify()
  }

  private _addMember(userId: string, displayName: string, isMuted: boolean) {
    if (!this._state) return
    if (this._state.members.find(m => m.userId === userId)) return
    this._state = {
      ...this._state,
      members: [...this._state.members, { userId, displayName, isMuted, isHandRaised: false, isSpeaking: false, isHost: userId === this._state.hostId }],
    }
    this._notify()
  }

  private _removeMember(userId: string) {
    if (!this._state) return
    this._pcs.get(userId)?.close()
    this._pcs.delete(userId)
    const audio = this._audioEls.get(userId)
    if (audio) { audio.srcObject = null; this._audioEls.delete(userId) }
    this._state = { ...this._state, members: this._state.members.filter(m => m.userId !== userId) }
    this._notify()
    // Auto-leave if only self remains
    if (this._state.members.length === 1 && this._state.members[0].userId === this._state.myUserId) {
      this.leaveRoom()
    }
  }

  private _updateMember(userId: string, patch: Partial<VoiceMember>) {
    if (!this._state) return
    this._state = {
      ...this._state,
      members: this._state.members.map(m => m.userId === userId ? { ...m, ...patch } : m),
    }
    this._notify()
  }

  private _notify() {
    this.onStateChange?.(this._state ? { ...this._state, members: [...this._state.members] } : null)
  }

  private _cleanup() {
    if (this._handInterval) { clearInterval(this._handInterval); this._handInterval = null }
    this._pcs.forEach(pc => pc.close())
    this._pcs.clear()
    this._audioEls.forEach(a => { a.srcObject = null })
    this._audioEls.clear()
    this._localStream?.getTracks().forEach(t => t.stop())
    this._localStream = null
    this._groupMembers = []
    this._state = null
  }
}

export const groupVoice = new GroupVoiceManager()
