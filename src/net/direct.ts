// 浏览器间分开使用可靠通道与无序、无重传状态通道。
// 局域网不使用 STUN；公网由调用方提供可选 STUN，失败时调用方回退中继。
import type { Member } from './protocol.ts';

interface Peer {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  stateChannel?: RTCDataChannel;
  fragments?: Map<number, { parts: Map<number, string>; total: number; at: number; bytes: number }>;
  generation: string;
  timer?: ReturnType<typeof setTimeout>;
  incoming?: { id: number; next: number; total: number; text: string };
  budget?: { tokens: number; at: number };
  candidates: RTCIceCandidateInit[];
  remotePending: RTCIceCandidateInit[];
  localCount: number;
  remoteCount: number;
  sentDescription: boolean;
  iceTimer?: ReturnType<typeof setTimeout>;
  created: number;
}
type Signal = { t: 'rtc'; generation: string } & (
  { type: 'offer' | 'answer'; sdp: string } | { type: 'ice'; candidates: RTCIceCandidateInit[] }
);
const MAX_BUFFER = 2 * 1024 * 1024;
const MAX_TEXT = 1024 * 1024;
const encoder = new TextEncoder();

export class DirectPeers {
  private peers = new Map<number, Peer>();
  private me = 0;
  private host = 0;
  private members: Member[] = [];
  private serial = 0;
  private closed = false;
  private iceServers: RTCIceServer[];
  skipped = 0;
  private signal: (id: number, text: string) => void;
  private receive: (id: number, text: string) => void;
  private changed: () => void;
  private error: (message: string) => void;
  constructor(
    signal: (id: number, text: string) => void,
    receive: (id: number, text: string) => void,
    changed: () => void,
    error: (message: string) => void,
    iceServers: RTCIceServer[] = [],
  ) { this.iceServers = iceServers; this.signal = signal; this.receive = receive; this.changed = changed; this.error = error; }

  get ready() { return this.targets().every(id => this.peerReady(id)); }
  peerReady(id: number) { return this.peers.get(id)?.pc.connectionState === 'connected' && this.peers.get(id)?.channel?.readyState === 'open' && this.peers.get(id)?.stateChannel?.readyState === 'open'; }
  diagnostics() {
    return this.targets().map(id => {
      const p = this.peers.get(id);
      return { id, local: p?.localCount ?? 0, remote: Math.max(p?.remoteCount ?? 0, p?.pc.remoteDescription?.sdp.match(/^a=candidate:/gm)?.length ?? 0), signaling: p?.pc.signalingState ?? 'new', ice: p?.pc.iceConnectionState ?? 'new', gathering: p?.pc.iceGatheringState ?? 'new', channel: p?.channel?.readyState ?? 'connecting', stateChannel: p?.stateChannel?.readyState ?? 'connecting', buffered: (p?.channel?.bufferedAmount ?? 0) + (p?.stateChannel?.bufferedAmount ?? 0), skipped: this.skipped, seconds: p ? Math.round((performance.now() - p.created) / 1000) : 0 };
    });
  }
  private targets() { return this.me === this.host ? this.members.filter(m => m.on && m.id !== this.me).map(m => m.id) : [this.host].filter(Boolean); }

  update(me: number, host: number, members: Member[]) {
    if (this.host && this.host !== host) this.clear();
    this.me = me; this.host = host; this.members = members;
    const wanted = new Set(this.targets());
    for (const id of this.peers.keys()) if (!wanted.has(id)) this.drop(id);
    if (me === host) for (const id of wanted) if (!this.peers.has(id)) void this.offer(id);
    this.changed();
  }

  private make(id: number, generation: string) {
    this.drop(id);
    const peer: Peer = { pc: new RTCPeerConnection({ iceServers: this.iceServers }), generation, candidates: [], remotePending: [], localCount: 0, remoteCount: 0, sentDescription: false, created: performance.now() };
    this.peers.set(id, peer);
    peer.pc.ondatachannel = e => this.bind(id, peer, e.channel);
    peer.pc.onicecandidate = e => {
      if (this.peers.get(id) !== peer) return;
      if (e.candidate && peer.localCount < 32) {
        peer.localCount++;
        peer.candidates.push(e.candidate.toJSON());
        if (peer.sentDescription) this.flushCandidates(id, peer);
      }
      this.changed();
    };
    peer.pc.oniceconnectionstatechange = () => this.changed();
    peer.pc.onicegatheringstatechange = () => this.changed();
    peer.pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      this.changed();
      if (['failed', 'disconnected', 'closed'].includes(peer.pc.connectionState)) this.retry(id, peer);
    };
    return peer;
  }

  private flushCandidates(id: number, peer: Peer) {
    if (peer.iceTimer || !peer.sentDescription) return;
    // 少量批次交换地址，后到的地址也发送；不把协商变成每秒大量控制消息。
    peer.iceTimer = setTimeout(() => {
      peer.iceTimer = undefined;
      if (this.peers.get(id) !== peer) return;
      while (peer.candidates.length) this.signal(id, JSON.stringify({ t: 'rtc', generation: peer.generation, type: 'ice', candidates: peer.candidates.splice(0, 4) } satisfies Signal));
    }, 50);
  }

  private async applyCandidates(peer: Peer) {
    if (!peer.pc.remoteDescription) return;
    while (peer.remotePending.length) await peer.pc.addIceCandidate(peer.remotePending.shift()!);
  }

  private async offer(id: number) {
    if (this.closed || !this.targets().includes(id)) return;
    const generation = `${Date.now()}-${++this.serial}`;
    const peer = this.make(id, generation);
    try {
      this.bind(id, peer, peer.pc.createDataChannel('game', { ordered: true }));
      this.bind(id, peer, peer.pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      const sdp = peer.pc.localDescription?.sdp ?? '';
      if (this.peers.get(id) !== peer) return;
      this.signal(id, JSON.stringify({ t: 'rtc', generation, type: 'offer', sdp } satisfies Signal));
      peer.sentDescription = true;
      this.flushCandidates(id, peer);
      this.retry(id, peer, 20000);
    } catch { if (this.peers.get(id) === peer) this.retry(id, peer); }
  }

  /** 只有当前房主与自己的成员连接能交换连接信息。 */
  async accept(from: number, text: string) {
    let m: Signal;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t !== 'rtc' || typeof m.generation !== 'string' || m.generation.length > 80 || !this.targets().includes(from)) return;
    try {
      if (m.type === 'ice') {
        const peer = this.peers.get(from);
        if (!peer || peer.generation !== m.generation || !Array.isArray(m.candidates) || m.candidates.length > 4) return;
        for (const c of m.candidates) {
          if (!c || typeof c.candidate !== 'string' || c.candidate.length > 2048 || peer.remoteCount >= 32) continue;
          peer.remoteCount++; peer.remotePending.push(c);
        }
        await this.applyCandidates(peer);
        this.changed();
        return;
      }
      if (typeof m.sdp !== 'string' || m.sdp.length > 16384) return;
      if (m.type === 'offer' && this.me !== this.host && from === this.host) {
        if (this.peers.get(from)?.generation === m.generation) return;
        const peer = this.make(from, m.generation);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
        await this.applyCandidates(peer);
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        const sdp = peer.pc.localDescription?.sdp ?? '';
        if (this.peers.get(from) === peer) {
          this.signal(from, JSON.stringify({ t: 'rtc', generation: m.generation, type: 'answer', sdp } satisfies Signal));
          peer.sentDescription = true; this.flushCandidates(from, peer);
        }
      } else if (m.type === 'answer' && this.me === this.host) {
        const peer = this.peers.get(from);
        if (peer?.generation === m.generation && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
          await this.applyCandidates(peer);
        }
      }
    } catch { this.error('局域网连接失败，请确认设备在同一网络'); }
  }

  private bind(id: number, peer: Peer, channel: RTCDataChannel) {
    const transient = channel.label === 'state';
    if (transient) peer.stateChannel = channel; else peer.channel = channel;
    channel.onopen = () => {
      if (this.peers.get(id) !== peer) return;
      clearTimeout(peer.timer);
      peer.timer = undefined;
      this.changed();
      // 重新直连后重新索取整份状态；游戏层沿用现有 hello 恢复流程。
      if (this.me !== this.host && this.peerReady(id)) this.receive(this.host, '{"t":"rtc-ready"}');
    };
    channel.onclose = () => { if (this.peers.get(id) === peer) { this.changed(); this.retry(id, peer); } };
    channel.onerror = () => {};
    channel.onmessage = e => {
      if (this.peers.get(id) !== peer || typeof e.data !== 'string') return;
      const text = e.data;
      if (!text.startsWith('~')) { this.deliver(id, peer, text); return; }
      try {
        const [serial, index, total, part] = JSON.parse(text.slice(1));
        if (!Number.isInteger(serial) || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > 128 || typeof part !== 'string' || part.length > 12000) return;
        if (transient) {
          const fragments = peer.fragments ??= new Map();
          const now = performance.now();
          for (const [key, value] of fragments) if (now - value.at > 300) fragments.delete(key);
          let inc = fragments.get(serial);
          if (!inc) {
            while (fragments.size >= 4) fragments.delete(fragments.keys().next().value!);
            inc = { parts: new Map(), total, at: now, bytes: 0 }; fragments.set(serial, inc);
          }
          if (inc.total !== total || index < 0 || index >= total || inc.parts.has(index)) return;
          inc.parts.set(index, part); inc.bytes += part.length;
          if (inc.bytes > (this.me === this.host ? 16384 : MAX_TEXT)) { fragments.delete(serial); return; }
          if (inc.parts.size === total) {
            fragments.delete(serial);
            this.deliver(id, peer, Array.from({ length: total }, (_, i) => inc!.parts.get(i)!).join(''));
          }
          return;
        }
        if (index === 0) peer.incoming = { id: serial, next: 0, total, text: '' };
        const inc = peer.incoming;
        if (!inc || inc.id !== serial || inc.next !== index || inc.total !== total) return;
        inc.text += part; inc.next++;
        if (inc.text.length > (this.me === this.host ? 16384 : MAX_TEXT)) { peer.incoming = undefined; return; }
        if (inc.next === total) { peer.incoming = undefined; this.deliver(id, peer, inc.text); }
      } catch { /* 无效分片不交给游戏层 */ }
    };
  }

  private deliver(id: number, peer: Peer, text: string) {
    const guest = this.me === this.host;
    const limit = guest ? 16384 : MAX_TEXT;
    if (text.length > limit || encoder.encode(text).byteLength > limit) return;
    const now = performance.now(), rate = guest ? 40 : 60;
    const budget = peer.budget ??= { tokens: rate * 2, at: now };
    budget.tokens = Math.min(rate * 2, budget.tokens + (now - budget.at) * rate / 1000); budget.at = now;
    if (budget.tokens < 1) { peer.channel?.close(); return; }
    budget.tokens--;
    this.receive(id, text);
  }

  send(text: string, to?: number, transient = false) {
    if (text.length > MAX_TEXT) return;
    const bytes = encoder.encode(text).byteLength;
    if (bytes > MAX_TEXT) return;
    const ids = to === undefined ? this.targets() : this.targets().filter(id => id === to);
    for (const id of ids) {
      const peer = this.peers.get(id);
      const unreliable = transient && bytes <= 65536;
      const ch = unreliable ? peer?.stateChannel : peer?.channel;
      if (!ch || ch.readyState !== 'open') continue;
      if (transient && ch.bufferedAmount > 65536) { this.skipped++; continue; }
      // 保持有界；积压时重建连接，由 hello/sync 恢复，不重放过时快照。
      if (ch.bufferedAmount + bytes + Math.ceil(text.length / (unreliable ? 3000 : 12000)) * 256 > MAX_BUFFER) { ch.close(); continue; }
      try {
        const size = unreliable ? 3000 : 12000;
        if (text.length <= size) ch.send(text);
        else {
          const serial = ++this.serial, total = Math.ceil(text.length / size);
          for (let index = 0; index < total; index++) ch.send('~' + JSON.stringify([serial, index, total, text.slice(index * size, (index + 1) * size)]));
        }
      } catch { ch.close(); }
    }
  }

  private retry(id: number, peer: Peer, ms = 1000) {
    if (this.me !== this.host || peer.timer || this.closed) return;
    peer.timer = setTimeout(() => {
      peer.timer = undefined;
      if (this.peers.get(id) !== peer || this.peerReady(id)) return;
      this.error('局域网连接尚未建立，请检查 VPN、代理，或改用公网联机');
      void this.offer(id);
    }, ms);
  }
  private drop(id: number) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id); clearTimeout(p.timer); clearTimeout(p.iceTimer); p.channel?.close(); p.stateChannel?.close(); p.pc.close();
  }
  private clear() { for (const id of this.peers.keys()) this.drop(id); }
  close() { this.closed = true; this.clear(); }
}
