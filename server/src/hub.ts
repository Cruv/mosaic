import type { WebSocket } from 'ws';
import type {
  ChatMessage,
  ClientMessage,
  FeedInfo,
  ReactionMessage,
  ServerMessage,
} from './types.js';

const MAX_NAME = 32;
const MAX_TEXT = 500;
const MAX_EMOJI = 16;
const CHAT_BACKLOG = 50;

interface Client {
  ws: WebSocket;
  name: string;
}

/**
 * The WebSocket hub: connection lifecycle, NTP-style time-sync, chat, reactions,
 * and roster fan-out. This is the control plane the browser viewer talks to
 * (the media plane is MediaMTX/WHEP).
 */
export class Hub {
  private clients = new Map<WebSocket, Client>();
  private chatBacklog: ChatMessage[] = [];
  private roster: FeedInfo[] = [];

  /** Called by the discovery loop when the live-feed set changes. */
  setRoster(feeds: FeedInfo[]): void {
    this.roster = feeds;
    this.broadcast({ t: 'roster', feeds });
  }

  add(ws: WebSocket): void {
    const client: Client = { ws, name: 'anon' };
    this.clients.set(ws, client);

    this.send(ws, {
      t: 'welcome',
      serverTime: Date.now(),
      feeds: this.roster,
      recent: this.chatBacklog,
    });

    ws.on('message', (data) => this.onMessage(client, data.toString()));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
  }

  private onMessage(client: Client, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'time:ping':
        // Reply immediately with the server clock so the client can estimate its
        // offset to the shared timeline. Keep this path as cheap as possible.
        this.send(client.ws, { t: 'time:pong', id: msg.id, c0: msg.c0, s: Date.now() });
        break;

      case 'hello':
        client.name = clean(msg.name, MAX_NAME) || 'anon';
        break;

      case 'chat': {
        const text = clean(msg.text, MAX_TEXT);
        if (!text) return;
        const out: ChatMessage = { name: client.name, text, ts: Date.now() };
        this.chatBacklog.push(out);
        if (this.chatBacklog.length > CHAT_BACKLOG) this.chatBacklog.shift();
        this.broadcast({ t: 'chat', msg: out });
        break;
      }

      case 'reaction': {
        const emoji = clean(msg.emoji, MAX_EMOJI);
        if (!emoji) return;
        const out: ReactionMessage = { emoji, ts: Date.now(), from: client.name };
        this.broadcast({ t: 'reaction', msg: out });
        break;
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const { ws } of this.clients.values()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }
}

/** Strip control chars, trim, and clamp length. Returns '' if nothing usable. */
function clean(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // Keep printable characters; drop C0/C1 control codes and DEL.
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim().slice(0, max);
}
