import type { ChatMessage, FeedInfo, ReactionMessage, ServerMessage } from './protocol';
import { TimeSync } from './timeSync';

type EventMap = {
  status: 'connecting' | 'open' | 'closed';
  roster: FeedInfo[];
  chat: ChatMessage;
  reaction: ReactionMessage;
};
type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void;

/**
 * The single WebSocket connection to the Mosaic control plane. Owns time-sync,
 * roster updates, chat, and reactions, and auto-reconnects. UI subscribes via on().
 */
export class MosaicConnection {
  readonly time = new TimeSync();
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private relaxTimer = 0;
  private pingId = 0;
  private name = 'anon';
  private listeners: { [K in keyof EventMap]: Set<Listener<K>> } = {
    status: new Set(),
    roster: new Set(),
    chat: new Set(),
    reaction: new Set(),
  };

  constructor(private wsUrl: string) {}

  on<K extends keyof EventMap>(event: K, cb: Listener<K>): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  private emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const cb of this.listeners[event]) cb(payload);
  }

  connect(): void {
    this.emit('status', 'connecting');
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.emit('status', 'open');
      this.rawSend({ t: 'hello', name: this.name });
      const ping = () => this.rawSend({ t: 'time:ping', id: this.pingId++, c0: Date.now() });
      ping();
      this.pingTimer = window.setInterval(ping, 2000);
      this.relaxTimer = window.setInterval(() => this.time.relax(), 15000);
    };

    ws.onmessage = (ev) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (m.t) {
        case 'welcome':
          this.time.seed(m.serverTime);
          this.emit('roster', m.feeds);
          for (const msg of m.recent) this.emit('chat', msg);
          break;
        case 'time:pong':
          this.time.onPong(m.c0, m.s);
          break;
        case 'roster':
          this.emit('roster', m.feeds);
          break;
        case 'chat':
          this.emit('chat', m.msg);
          break;
        case 'reaction':
          this.emit('reaction', m.msg);
          break;
      }
    };

    const onDown = () => {
      window.clearInterval(this.pingTimer);
      window.clearInterval(this.relaxTimer);
      if (this.ws === ws) {
        this.emit('status', 'closed');
        this.ws = null;
        setTimeout(() => this.connect(), 1500);
      }
    };
    ws.onclose = onDown;
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  setName(name: string): void {
    this.name = name || 'anon';
    this.rawSend({ t: 'hello', name: this.name });
  }

  sendChat(text: string): void {
    this.rawSend({ t: 'chat', text });
  }

  sendReaction(emoji: string): void {
    this.rawSend({ t: 'reaction', emoji });
  }

  private rawSend(msg: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
