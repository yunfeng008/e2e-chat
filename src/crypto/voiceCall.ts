export type CallState = 'idle' | 'outgoing' | 'incoming' | 'connected'

export interface CallSession {
  peerId: string
  peerName: string
  state: CallState
  startedAt?: number
  isMuted: boolean
  isSpeakerOn: boolean
}

type StateHandler = (session: CallSession | null) => void

class VoiceCallManager {
  private pc: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private _session: CallSession | null = null
  private _socket: unknown = null
  private _pendingOffer: RTCSessionDescriptionInit | null = null
  private _signalingBound = false  // 防止重复绑定

  onStateChange: StateHandler | null = null

  setSocket(socket: unknown) {
    this._socket = socket
    if (!this._signalingBound) {
      this._signalingBound = true
      this._bindSignaling()
    }
  }

  private _emit(event: string, data: unknown) {
    (this._socket as { emit: (e: string, d: unknown) => void } | null)?.emit(event, data)
  }

  private _bindSignaling() {
    const s = this._socket as { on: (e: string, cb: (d: unknown) => void) => void }

    s.on('call_offer', (data: unknown) => {
      const { from, fromName, sdp } = data as { from: string; fromName: string; sdp: RTCSessionDescriptionInit }
      console.log('[VoiceCall] incoming call from', from)
      if (this._session) { this._emit('call_reject', { to: from, reason: 'busy' }); return }
      this._session = { peerId: from, peerName: fromName, state: 'incoming', isMuted: false, isSpeakerOn: true }
      this._pendingOffer = sdp
      this._notify()
    })

    s.on('call_answer', async (data: unknown) => {
      const { sdp } = data as { sdp: RTCSessionDescriptionInit }
      console.log('[VoiceCall] got answer')
      if (!this.pc) { console.warn('[VoiceCall] got answer but no pc'); return }
      try { await this.pc.setRemoteDescription(new RTCSessionDescription(sdp)) }
      catch (e) { console.error('[VoiceCall] setRemoteDescription failed', e) }
    })

    s.on('call_ice', async (data: unknown) => {
      const { candidate } = data as { candidate: RTCIceCandidateInit }
      if (this.pc && candidate) {
        try { await this.pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      }
    })

    s.on('call_reject', (data: unknown) => {
      console.log('[VoiceCall] call rejected', data)
      this._cleanup(); this._notify()
    })

    s.on('call_hangup', (data: unknown) => {
      console.log('[VoiceCall] call hangup', data)
      this._cleanup(); this._notify()
    })
  }

  async call(peerId: string, peerName: string, myName: string) {
    console.log('[VoiceCall] call() start, current session:', this._session)
    if (this._session) {
      console.warn('[VoiceCall] already in call, ignoring')
      return
    }

    this._session = { peerId, peerName, state: 'outgoing', isMuted: false, isSpeakerOn: true }
    console.log('[VoiceCall] session set to outgoing, notifying...')
    this._notify()
    console.log('[VoiceCall] onStateChange is:', this.onStateChange ? 'registered' : 'NULL — UI will not update!')

    try {
      console.log('[VoiceCall] requesting microphone...')
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      console.log('[VoiceCall] microphone granted')

      this.pc = this._createPC(peerId)
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))

      const offer = await this.pc.createOffer()
      await this.pc.setLocalDescription(offer)
      console.log('[VoiceCall] offer created and set, sending...')

      this._emit('call_offer', { to: peerId, fromName: myName, sdp: offer })
    } catch (err) {
      console.error('[VoiceCall] call() error:', err)
      this._cleanup()
      this._notify()
    }
  }

  async accept() {
    console.log('[VoiceCall] accept()')
    if (!this._session || this._session.state !== 'incoming' || !this._pendingOffer) return
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      this.pc = this._createPC(this._session.peerId)
      this.localStream.getTracks().forEach(t => this.pc!.addTrack(t, this.localStream!))
      await this.pc.setRemoteDescription(new RTCSessionDescription(this._pendingOffer))
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      this._pendingOffer = null
      this._emit('call_answer', { to: this._session.peerId, sdp: answer })
      this._session = { ...this._session, state: 'connected', startedAt: Date.now() }
      this._notify()
    } catch (err) {
      console.error('[VoiceCall] accept() error:', err)
      this._cleanup(); this._notify()
    }
  }

  reject() {
    if (!this._session) return
    this._emit('call_reject', { to: this._session.peerId, reason: 'rejected' })
    this._cleanup(); this._notify()
  }

  hangup() {
    if (!this._session) return
    console.log('[VoiceCall] hangup')
    this._emit('call_hangup', { to: this._session.peerId })
    this._cleanup(); this._notify()
  }

  toggleMute() {
    if (!this.localStream || !this._session) return
    const wasMuted = this._session.isMuted
    this.localStream.getAudioTracks().forEach(t => { t.enabled = wasMuted })
    this._session = { ...this._session, isMuted: !wasMuted }
    this._notify()
  }

  toggleSpeaker() {
    if (!this._session) return
    const next = !this._session.isSpeakerOn
    this._session = { ...this._session, isSpeakerOn: next }
    const audio = document.getElementById('sc-remote-audio') as HTMLAudioElement | null
    if (audio) audio.muted = !next
    this._notify()
  }

  getSession() { return this._session }

  private _notify() {
    console.log('[VoiceCall] _notify, session:', this._session?.state ?? 'null', 'handler:', !!this.onStateChange)
    this.onStateChange?.(this._session ? { ...this._session } : null)
  }

  private _createPC(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: [] })

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this._emit('call_ice', { to: peerId, candidate: candidate.toJSON() })
    }

    pc.ontrack = ({ streams }) => {
      console.log('[VoiceCall] ontrack fired')
      const audio = document.getElementById('sc-remote-audio') as HTMLAudioElement | null
      if (audio && streams[0]) { audio.srcObject = streams[0]; audio.play().catch(() => {}) }
      if (this._session && this._session.state !== 'connected') {
        this._session = { ...this._session, state: 'connected', startedAt: Date.now() }
        this._notify()
      }
    }

    pc.onconnectionstatechange = () => {
      console.log('[VoiceCall] connectionState:', pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this._cleanup(); this._notify()
      }
    }

    pc.onsignalingstatechange = () => {
      console.log('[VoiceCall] signalingState:', pc.signalingState)
    }

    return pc
  }

  private _cleanup() {
    console.log('[VoiceCall] cleanup()')
    this.pc?.close()
    this.pc = null
    this.localStream?.getTracks().forEach(t => t.stop())
    this.localStream = null
    this._pendingOffer = null
    this._session = null
    const audio = document.getElementById('sc-remote-audio') as HTMLAudioElement | null
    if (audio) audio.srcObject = null
  }
}

export const voiceCall = new VoiceCallManager()
