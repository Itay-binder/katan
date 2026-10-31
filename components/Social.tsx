'use client';
// Chat and voice call for a room.
import { useEffect, useRef, useState } from 'react';
import { chatApi, onRoomEvent, presenceApi, type ChatMsg } from '@/lib/client';
import { HEARTBEAT_MS, type Seen } from '@/lib/engine/presence';
import { VoiceRoom, type VoiceState } from '@/lib/voice';

const EMPTY: VoiceState = { joined: false, joining: false, muted: false, members: [], speaking: [], failed: [], error: '' };

export function useVoice(roomId: string, meId: string | null) {
  const [state, setState] = useState<VoiceState>(EMPTY);
  const room = useRef<VoiceRoom | null>(null);
  useEffect(() => {
    if (!meId) return;
    const v = new VoiceRoom(roomId, meId, setState);
    room.current = v;
    const bye = () => v.leave();
    window.addEventListener('pagehide', bye);
    return () => { window.removeEventListener('pagehide', bye); v.destroy(); room.current = null; };
  }, [roomId, meId]);
  return {
    state,
    join: () => room.current?.join(),
    leave: () => room.current?.leave(),
    toggleMute: () => room.current?.toggleMute(),
  };
}

/** Reports whether this screen has the game open, and keeps the room's list of who is away. */
export function usePresence(roomId: string, token: string | null, meId: string | null) {
  const [seen, setSeen] = useState<Record<string, Seen> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => presenceApi.list(roomId).then(r => { if (alive) setSeen(r.presence); }).catch(() => {});
    load();
    const off = onRoomEvent('presence', load);
    let iv: ReturnType<typeof setInterval> | null = null;
    if (meId && token) {
      const visible = () => document.visibilityState === 'visible';
      const report = () => presenceApi.mark(roomId, token, !visible());
      report();
      iv = setInterval(() => { if (visible()) report(); }, HEARTBEAT_MS);
      document.addEventListener('visibilitychange', report);
      const gone = () => presenceApi.mark(roomId, token, true);
      window.addEventListener('pagehide', gone);
      return () => {
        alive = false; off(); if (iv) clearInterval(iv);
        document.removeEventListener('visibilitychange', report);
        window.removeEventListener('pagehide', gone);
      };
    }
    return () => { alive = false; off(); };
  }, [roomId, token, meId]);
  return seen;
}

/** Chat history plus live messages. `onIncoming` fires for messages from other players. */
export function useChat(roomId: string, meId: string | null, onIncoming: (m: ChatMsg) => void) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const cb = useRef(onIncoming);
  cb.current = onIncoming;
  useEffect(() => {
    let alive = true;
    chatApi.list(roomId).then(r => { if (alive) setMessages(m => merge(r.messages, m)); }).catch(() => {});
    const off = onRoomEvent<ChatMsg>('chat', m => {
      setMessages(list => merge(list, [m]));
      if (m.player_id !== meId) cb.current(m);
    });
    return () => { alive = false; off(); };
  }, [roomId, meId]);
  const add = (m: ChatMsg) => setMessages(list => merge(list, [m]));
  return { messages, add };
}

const merge = (a: ChatMsg[], b: ChatMsg[]) => {
  const byId = new Map<number, ChatMsg>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.id - y.id).slice(-100);
};

export function ChatPanel({ roomId, token, meId, messages, add, close }: {
  roomId: string; token: string | null; meId: string | null; messages: ChatMsg[]; add: (m: ChatMsg) => void; close: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await chatApi.send(roomId, token, t);
      add(r.message);
      setText('');
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="sheet-back" onClick={close}>
      <div className="sheet chat" onClick={e => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 className="grow" style={{ margin: 0 }}>צ׳אט</h3>
          <button className="btn light small" onClick={close}>סגור</button>
        </div>
        <div className="chat-list">
          {!messages.length && <p className="chat-empty">עוד לא כתבו כלום. תתחיל אתה.</p>}
          {messages.map(m => (
            <div key={m.id} className={`chat-msg ${m.player_id === meId ? 'mine' : ''}`}>
              {m.player_id !== meId && <span className={`chat-name t-${m.color}`}>{m.name}</span>}
              <span>{m.text}</span>
            </div>
          ))}
          <div ref={end} />
        </div>
        {err && <p className="chat-err">{err}</p>}
        <form className="chat-form" onSubmit={e => { e.preventDefault(); send(); }}>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={300} placeholder="כתוב הודעה…" enterKeyHint="send" />
          <button className="btn" disabled={!text.trim() || busy}>שלח</button>
        </form>
      </div>
    </div>
  );
}
