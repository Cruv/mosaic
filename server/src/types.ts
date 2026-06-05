// Wire protocol shared (by copy) with web/src/net/protocol.ts.
// KEEP IN SYNC with the web copy.

/** A live feed currently being published to MediaMTX. */
export interface FeedInfo {
  /** MediaMTX path name == the feed/stream key the streamer published to. */
  name: string;
  /** Server wall-clock (ms) when the feed became available, if known. */
  since?: number;
  /** Codecs detected on the feed, for display (e.g. ["H264", "OPUS"]). */
  codecs?: string[];
}

export interface ChatMessage {
  name: string;
  text: string;
  /** Server wall-clock ms. */
  ts: number;
}

export interface ReactionMessage {
  emoji: string;
  /** Server wall-clock ms. */
  ts: number;
  from: string;
}

// ---- Client -> Server ----
export type ClientMessage =
  | { t: 'hello'; name?: string }
  | { t: 'time:ping'; id: number; c0: number }
  | { t: 'chat'; text: string }
  | { t: 'reaction'; emoji: string };

// ---- Server -> Client ----
export type ServerMessage =
  | { t: 'welcome'; serverTime: number; feeds: FeedInfo[]; recent: ChatMessage[] }
  | { t: 'time:pong'; id: number; c0: number; s: number }
  | { t: 'roster'; feeds: FeedInfo[] }
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'reaction'; msg: ReactionMessage };
