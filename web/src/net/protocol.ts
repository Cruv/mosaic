// Wire protocol — copy of server/src/types.ts. KEEP IN SYNC with the server copy.

export interface FeedInfo {
  name: string;
  since?: number;
  codecs?: string[];
}

export interface ChatMessage {
  name: string;
  text: string;
  ts: number;
}

export interface ReactionMessage {
  emoji: string;
  ts: number;
  from: string;
}

export type ClientMessage =
  | { t: 'hello'; name?: string }
  | { t: 'time:ping'; id: number; c0: number }
  | { t: 'chat'; text: string }
  | { t: 'reaction'; emoji: string };

export type ServerMessage =
  | { t: 'welcome'; serverTime: number; feeds: FeedInfo[]; recent: ChatMessage[] }
  | { t: 'time:pong'; id: number; c0: number; s: number }
  | { t: 'roster'; feeds: FeedInfo[] }
  | { t: 'chat'; msg: ChatMessage }
  | { t: 'reaction'; msg: ReactionMessage };
