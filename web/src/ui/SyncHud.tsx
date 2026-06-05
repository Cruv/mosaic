import { useMetrics } from './context';

function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${hot ? 'stat-hot' : ''}`}>{value}</div>
    </div>
  );
}

/** Live readout of the sync engine — most importantly the measured inter-feed
 *  skew, which is the product's headline quality number. */
export function SyncHud({ onClose }: { onClose: () => void }) {
  const m = useMetrics(120);
  return (
    <div className="hud">
      <div className="hud-head">
        <strong>Sync engine</strong>
        <button className="btn-icon" onClick={onClose} title="Hide">
          ✕
        </button>
      </div>
      <div className="hud-stats">
        <Stat label="Client clock" value={m.synced ? 'synced' : 'syncing…'} hot={!m.synced} />
        <Stat label="Behind live" value={`${Math.round(m.targetLatencyMs)} ms`} />
        <Stat label="Inter-feed skew" value={`${m.residualSkewMs.toFixed(0)} ms`} hot={m.residualSkewMs > 50} />
        <Stat label="Synced feeds" value={`${m.syncedFeeds}`} />
      </div>
      <table className="hud-table">
        <thead>
          <tr>
            <th>feed</th>
            <th>lat</th>
            <th>fps</th>
            <th>tc</th>
          </tr>
        </thead>
        <tbody>
          {m.feeds.map((f) => (
            <tr key={f.name} className={f.live ? '' : 'row-off'}>
              <td className="hud-feed">{f.name}</td>
              <td>{Number.isFinite(f.latencyMs) ? Math.round(f.latencyMs) : '—'}</td>
              <td>{f.fps ? Math.round(f.fps) : '—'}</td>
              <td title={f.hasTimecode ? 'timecode-synced' : 'fallback/approx'}>{f.hasTimecode ? '●' : '○'}</td>
            </tr>
          ))}
          {m.feeds.length === 0 && (
            <tr>
              <td colSpan={4} className="hud-empty">
                no feeds
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hud-note">
        Skew = spread of presented capture times across timecode-synced feeds. Lower is tighter sync.
      </p>
    </div>
  );
}
