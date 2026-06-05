import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { MosaicConnection } from '../net/connection';
import type { SyncEngine, SyncMetrics } from '../sync/syncEngine';
import type { ChatMessage, FeedInfo, ReactionMessage } from '../net/protocol';

interface MosaicCtx {
  connection: MosaicConnection;
  engine: SyncEngine;
}

const Ctx = createContext<MosaicCtx | null>(null);

export function MosaicProvider({
  connection,
  engine,
  children,
}: {
  connection: MosaicConnection;
  engine: SyncEngine;
  children: ReactNode;
}) {
  return <Ctx.Provider value={{ connection, engine }}>{children}</Ctx.Provider>;
}

export function useMosaic(): MosaicCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useMosaic outside provider');
  return c;
}

/** Live roster of published feeds. */
export function useRoster(): FeedInfo[] {
  const { connection } = useMosaic();
  const [feeds, setFeeds] = useState<FeedInfo[]>([]);
  useEffect(() => connection.on('roster', setFeeds), [connection]);
  return feeds;
}

/** Polls the engine for sync metrics at a modest rate (canvases draw via the
 *  engine's own rAF, independent of React). */
export function useMetrics(intervalMs = 200): SyncMetrics {
  const { engine } = useMosaic();
  const [m, setM] = useState<SyncMetrics>(engine.getMetrics());
  useEffect(() => {
    const id = window.setInterval(() => setM(engine.getMetrics()), intervalMs);
    return () => window.clearInterval(id);
  }, [engine, intervalMs]);
  return m;
}

/** Current program feed name (driven by the engine's strategy / manual pin). */
export function useProgram(): string | null {
  const { engine } = useMosaic();
  const [p, setP] = useState<string | null>(engine.program);
  useEffect(() => {
    engine.onProgramChange = setP;
    setP(engine.program);
    return () => {
      if (engine.onProgramChange === setP) engine.onProgramChange = undefined;
    };
  }, [engine]);
  return p;
}

export function useChat(max = 200): ChatMessage[] {
  const { connection } = useMosaic();
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  useEffect(
    () => connection.on('chat', (m) => setMsgs((prev) => [...prev.slice(-(max - 1)), m])),
    [connection, max],
  );
  return msgs;
}

/** Subscribe to incoming reactions (for the floating overlay). */
export function useReactionFeed(cb: (r: ReactionMessage) => void): void {
  const { connection } = useMosaic();
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => connection.on('reaction', (r) => ref.current(r)), [connection]);
}
