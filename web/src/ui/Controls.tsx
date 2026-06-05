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
        <span className="ctl-label" title="How far behind live we present, to absorb jitter while staying aligned">
          Behind live
        </span>
        <input
          className="range"
          type="range"
          min={250}
          max={800}
          step={10}
          value={config.targetBehindLiveMs}
          onChange={(e) => {
            const v = Number(e.target.value);
            onConfig({ targetBehindLiveMs: v, maxBehindLiveMs: Math.max(800, v) });
          }}
        />
        <span className="ctl-value">{config.targetBehindLiveMs} ms</span>
      </div>

      <label className="ctl-check" title="Delay program audio to match the buffered video">
        <input type="checkbox" checked={config.alignAudio} onChange={(e) => onConfig({ alignAudio: e.target.checked })} />
        Align audio
      </label>

      <label className="ctl-check" title="Use the burned-in timecode band for frame-accurate sync">
        <input type="checkbox" checked={config.useTimecode} onChange={(e) => onConfig({ useTimecode: e.target.checked })} />
        Timecode
      </label>

      <button className="btn btn-sm" onClick={onToggleHud}>
        Sync HUD
      </button>
    </div>
  );
}
