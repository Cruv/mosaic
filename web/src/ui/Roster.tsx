import { FeedCanvas } from './FeedCanvas';
import { useMetrics, useRoster } from './context';

/** Live feed thumbnails with per-feed sync badges and program / PiP actions. */
export function Roster({
  program,
  pips,
  onSetProgram,
  onTogglePip,
}: {
  program: string | null;
  pips: string[];
  onSetProgram: (name: string) => void;
  onTogglePip: (name: string) => void;
}) {
  const roster = useRoster();
  const metrics = useMetrics();
  const byName = new Map(metrics.feeds.map((f) => [f.name, f]));

  if (roster.length === 0) {
    return <div className="roster-empty">Waiting for streams…</div>;
  }

  return (
    <div className="roster">
      {roster.map((feed) => {
        const m = byName.get(feed.name);
        const isProg = program === feed.name;
        const isPip = pips.includes(feed.name);
        return (
          <div key={feed.name} className={`tile ${isProg ? 'tile-prog' : ''}`}>
            <div className="tile-video">
              <FeedCanvas surfaceId={`thumb-${feed.name}`} feedName={feed.name} className="tile-canvas" />
              {isProg && <span className="tile-tag tag-prog">PGM</span>}
              {m && (
                <span
                  className={`tile-tag ${m.hasTimecode ? 'tag-sync' : 'tag-approx'}`}
                  title={m.hasTimecode ? 'Timecode-synced (frame-accurate)' : 'No timecode — approximate sync'}
                >
                  {m.hasTimecode ? 'TC' : '~'}
                </span>
              )}
            </div>
            <div className="tile-meta">
              <span className="tile-name" title={feed.name}>
                {feed.name}
              </span>
              <span className="tile-lat">
                {m && Number.isFinite(m.latencyMs) ? `${Math.round(m.latencyMs)} ms` : '—'}
              </span>
            </div>
            <div className="tile-actions">
              <button
                className={`btn btn-sm ${isProg ? 'btn-on' : ''}`}
                onClick={() => onSetProgram(feed.name)}
              >
                Program
              </button>
              <button className={`btn btn-sm ${isPip ? 'btn-on' : ''}`} onClick={() => onTogglePip(feed.name)}>
                PiP
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
