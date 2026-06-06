import type { SyncConfig } from '../sync/config';
import type { SwitchStrategy } from '../switch/strategy';

/** Standard live controls + the sync/latency tradeoff dials. */
export function Controls({
  strategies,
  strategyId,
  onStrategy,
  manual,
  onAuto,
  volume,
  onVolume,
  config,
  onConfig,
  onToggleHud,
}: {
  strategies: SwitchStrategy[];
  strategyId: string;
  onStrategy: (id: string) => void;
  manual: string | null;
  onAuto: () => void;
  volume: number;
  onVolume: (v: number) => void;
  config: SyncConfig;
  onConfig: (patch: Partial<SyncConfig>) => void;
  onToggleHud: () => void;
}) {
  return (
    <div className="controls">
      <div className="ctl-group">
        <span className="ctl-label">Director</span>
        <select className="select" value={strategyId} onChange={(e) => onStrategy(e.target.value)}>
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button
          className={`btn btn-sm ${manual ? '' : 'btn-on'}`}
          title={manual ? 'Click to resume the auto-director' : 'Auto-director active'}
          onClick={onAuto}
        >
          {manual ? `Pinned: ${manual}` : 'Auto'}
        </button>
      </div>

      <div className="ctl-group">
        <span className="ctl-label">🔊</span>
        <input
          className="range"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
        />
      </div>

      <div className="ctl-group">
        <span
          className="ctl-label"
          title="Extra delay beyond each feed's own latency — absorbs jitter and holds alignment. Lower = less latency (more stutter risk on jittery networks)."
        >
          Sync buffer
        </span>
        <input
          className="range"
          type="range"
          min={0}
          max={500}
          step={10}
          value={config.jitterMarginMs}
          onChange={(e) => onConfig({ jitterMarginMs: Number(e.target.value) })}
        />
        <span className="ctl-value">{config.jitterMarginMs} ms</span>
      </div>

      <label className="ctl-check" title="Delay program audio to match the buffered video">
        <input type="checkbox" checked={config.alignAudio} onChange={(e) => onConfig({ alignAudio: e.target.checked })} />
        Align audio
      </label>

      <label className="ctl-check" title="Use the burned-in timecode band for frame-accurate sync">
        <input type="checkbox" checked={config.useTimecode} onChange={(e) => onConfig({ useTimecode: e.target.checked })} />
        Timecode
      </label>

      {config.useTimecode && (
        <div className="ctl-group">
          <span className="ctl-label" title="How much of the top edge to crop to hide the timecode band — raise until it's fully gone">
            crop
          </span>
          <input
            className="range"
            type="range"
            min={0.03}
            max={0.15}
            step={0.005}
            value={config.cropFraction}
            onChange={(e) => onConfig({ cropFraction: Number(e.target.value) })}
          />
          <span className="ctl-value">{Math.round(config.cropFraction * 100)}%</span>
        </div>
      )}

      <button className="btn btn-sm" onClick={onToggleHud}>
        Sync HUD
      </button>
    </div>
  );
}
