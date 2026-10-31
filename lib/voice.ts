'use client';
// Room voice call: every player in the call connects straight to every other one (WebRTC mesh, max 4).
// The room's realtime channel carries the handshake ('voice' events); audio never touches our servers.
import { onRoomEvent, sendRoomEvent } from './client';

type Sig =
  | { kind: 'who' | 'join' | 'here' | 'leave'; from: string; to?: string }
  | { kind: 'offer' | 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; cand: RTCIceCandidateInit };

export interface VoiceState {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  members: string[];   // player ids in the call (as far as we know)
  speaking: string[];  // player ids talking right now (only known while you are in the call)
  failed: string[];    // players we could not connect to
  error: string;
}

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const SPEAK_LEVEL = 0.04;

interface Peer { pc: RTCPeerConnection; audio: HTMLAudioElement; analyser?: AnalyserNode; pending: RTCIceCandidateInit[] }

export class VoiceRoom {
  private peers = new Map<string, Peer>();
  private local: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private localAnalyser?: AnalyserNode;
  private members = new Set<string>();
  private failed = new Set<string>();
  private speaking: string[] = [];
  private meter: ReturnType<typeof setInterval> | null = null;
  private off: () => void;
  private st: Omit<VoiceState, 'members' | 'speaking' | 'failed'> = { joined: false, joining: false, muted: false, error: '' };

  constructor(private room: string, private me: string, private onChange: (s: VoiceState) => void) {
    this.off = onRoomEvent<Sig>('voice', m => { this.handle(m).catch(e => console.warn('voice', e)); });
    // Ask who is already talking (twice, in case the channel was still connecting).
    this.send({ kind: 'who', from: me });
    setTimeout(() => this.send({ kind: 'who', from: me }), 2500);
  }

  get state(): VoiceState {
    return { ...this.st, members: [...this.members], speaking: this.speaking, failed: [...this.failed] };
  }

  private emit() { this.onChange(this.state); }
  private send(m: Sig) { sendRoomEvent(this.room, 'voice', m); }

  async join() {
    if (this.st.joined || this.st.joining) return;
    this.st = { ...this.st, joining: true, error: '' }; this.emit();
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.st = { ...this.st, joining: false, error: 'אין גישה למיקרופון. צריך לאשר מיקרופון בדפדפן.' }; this.emit();
      return;
    }
    try {
      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.localAnalyser = this.analyse(this.local);
    } catch { /* speaking meter is optional */ }
    this.st = { ...this.st, joined: true, joining: false, muted: false };
    this.members.add(this.me);
    this.failed.clear();
    this.meter = setInterval(() => this.measure(), 250);
    this.send({ kind: 'join', from: this.me });
    this.emit();
  }

  leave(notify = true) {
    if (!this.st.joined) return;
    if (notify) this.send({ kind: 'leave', from: this.me });
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.local?.getTracks().forEach(t => t.stop());
    this.local = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.members.delete(this.me);
    this.speaking = [];
    this.failed.clear();
    this.st = { ...this.st, joined: false, muted: false };
    this.emit();
  }

  toggleMute() {
    if (!this.local) return;
    const muted = !this.st.muted;
    this.local.getAudioTracks().forEach(t => { t.enabled = !muted; });
    this.st = { ...this.st, muted };
    this.emit();
  }

  destroy() { this.leave(); this.off(); }

  private async handle(m: Sig) {
    if (m.from === this.me || ('to' in m && m.to && m.to !== this.me)) return;
    switch (m.kind) {
      case 'who':
        if (this.st.joined) this.send({ kind: 'here', from: this.me });
        return;
      case 'join':
      case 'here':
        this.members.add(m.from);
        if (this.st.joined) {
          if (m.kind === 'join') this.send({ kind: 'here', from: this.me, to: m.from });
          // Exactly one side of each pair starts the connection: the smaller id.
          if (this.me < m.from && !this.peers.has(m.from)) await this.call(m.from);
        }
        this.emit();
        return;
      case 'leave':
        this.members.delete(m.from);
        this.failed.delete(m.from);
        this.closePeer(m.from);
        this.emit();
        return;
      case 'offer': {
        if (!this.st.joined) return;
        this.closePeer(m.from);
        const p = this.peer(m.from);
        await p.pc.setRemoteDescription(m.sdp);
        await this.flush(p);
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        this.send({ kind: 'answer', from: this.me, to: m.from, sdp: answer });
        return;
      }
      case 'answer': {
        const p = this.peers.get(m.from);
        if (!p || p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription(m.sdp);
        await this.flush(p);
        return;
      }
      case 'ice': {
        const p = this.peers.get(m.from);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.cand).catch(() => {});
        else p.pending.push(m.cand);
        return;
      }
    }
  }

  private async flush(p: Peer) {
    for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private async call(id: string) {
    const p = this.peer(id);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send({ kind: 'offer', from: this.me, to: id, sdp: offer });
  }

  private peer(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    const p: Peer = { pc, audio, pending: [] };
    this.peers.set(id, p);
    this.local?.getTracks().forEach(t => pc.addTrack(t, this.local!));
    pc.onicecandidate = e => { if (e.candidate) this.send({ kind: 'ice', from: this.me, to: id, cand: e.candidate.toJSON() }); };
    pc.ontrack = e => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
      p.analyser = this.analyse(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { this.failed.delete(id); this.emit(); }
      if (pc.connectionState === 'failed') { this.failed.add(id); this.closePeer(id); this.emit(); }
    };
    return p;
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    p.pc.close();
    p.audio.srcObject = null;
  }

  private analyse(stream: MediaStream): AnalyserNode | undefined {
    if (!this.ctx) return undefined;
    try {
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      this.ctx.createMediaStreamSource(stream).connect(a);
      return a;
    } catch { return undefined; }
  }

  private measure() {
    const level = (a?: AnalyserNode) => {
      if (!a) return 0;
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
    const now: string[] = [];
    if (!this.st.muted && level(this.localAnalyser) > SPEAK_LEVEL) now.push(this.me);
    for (const [id, p] of this.peers) if (level(p.analyser) > SPEAK_LEVEL) now.push(id);
    if (now.join() !== this.speaking.join()) { this.speaking = now; this.emit(); }
  }
}
