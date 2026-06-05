import { useRef, useState } from 'react';
import { FeedCanvas } from './FeedCanvas';
import { useReactionFeed } from './context';

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export interface Pip {
  name: string;
  corner: Corner;
}

export const nextCorner = (c: Corner): Corner =>
  (({ tl: 'tr', tr: 'br', br: 'bl', bl: 'tl' }) as const)[c];

interface Float {
  id: number;
  emoji: string;
  left: number;
}

/** The program view: the synchronized program feed, PiP overlays, a floating
 *  reaction layer, and standard live controls (fullscreen). */
export function ProgramView({
  program,
  pips,
  onCyclePip,
  onRemovePip,
}: {
  program: string | null;
  pips: Pip[];
  onCyclePip: (name: string) => void;
  onRemovePip: (name: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [floats, setFloats] = useState<Float[]>([]);
  const idRef = useRef(0);

  useReactionFeed((r) => {
    const id = idRef.current++;
    const left = 6 + Math.random() * 86;
    setFloats((f) => [...f, { id, emoji: r.emoji, left }]);
    window.setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 2600);
  });

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  return (
    <div className="program" ref={containerRef}>
      {program ? (
        <FeedCanvas surfaceId="program" feedName={program} className="program-canvas" />
      ) : (
        <div className="program-empty">
          <div>No feeds live yet</div>
          <span>Start an OBS WHIP stream to populate the wall.</span>
        </div>
      )}

      <div className="program-badge">{program ? `PROGRAM · ${program}` : 'PROGRAM'}</div>
      <button className="btn-icon program-fs" title="Fullscreen" onClick={toggleFullscreen}>
        ⛶
      </button>

      {pips.map((p) => (
        <div key={p.name} className={`pip pip-${p.corner}`}>
          <FeedCanvas surfaceId={`pip-${p.name}`} feedName={p.name} className="pip-canvas" />
          <div className="pip-bar">
            <span className="pip-name">{p.name}</span>
            <button className="btn-icon" title="Move corner" onClick={() => onCyclePip(p.name)}>
              ⟲
            </button>
            <button className="btn-icon" title="Remove PiP" onClick={() => onRemovePip(p.name)}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="reactions-layer">
        {floats.map((f) => (
          <span key={f.id} className="reaction-float" style={{ left: `${f.left}%` }}>
            {f.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}
