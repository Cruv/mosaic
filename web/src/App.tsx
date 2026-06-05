import { useMemo, useState } from 'react';
import { useMetrics, useMosaic, useProgram } from './ui/context';
import { NameGate } from './ui/NameGate';
import { ProgramView, nextCorner, type Pip } from './ui/ProgramView';
import { Roster } from './ui/Roster';
import { Controls } from './ui/Controls';
import { SyncHud } from './ui/SyncHud';
import { Chat } from './ui/Chat';
import { makeStrategies } from './switch/strategy';
import type { SyncConfig } from './sync/config';

function StatusBar() {
  const m = useMetrics(250);
  return (
    <div className="status">
      <span className={`dot ${m.synced ? 'dot-ok' : 'dot-warn'}`} />
      <span className="status-text">{m.synced ? 'clock synced' : 'syncing'}</span>
      <span className="status-sep">·</span>
      <span className="status-text">{m.syncedFeeds} synced</span>
      <span className="status-sep">·</span>
      <span className={`status-text ${m.residualSkewMs > 50 ? 'status-hot' : ''}`}>
        skew {m.residualSkewMs.toFixed(0)} ms
      </span>
      <span className="status-sep">·</span>
      <span className="status-text">{Math.round(m.targetLatencyMs)} ms behind</span>
    </div>
  );
}

export function App() {
  const { engine } = useMosaic();
  const [name, setName] = useState<string | null>(null);
  const program = useProgram();

  const strategies = useMemo(() => makeStrategies(), []);
  const [strategyId, setStrategyId] = useState(engine.strategyId);
  const [manual, setManual] = useState<string | null>(null);
  const [pips, setPips] = useState<Pip[]>([]);
  const [volume, setVolume] = useState(1);
  const [cfg, setCfg] = useState<SyncConfig>(engine.config);
  const [showHud, setShowHud] = useState(true);

  if (!name) return <NameGate onEnter={setName} />;

  const setProgram = (n: string) => {
    engine.setManualProgram(n);
    setManual(n);
  };
  const auto = () => {
    engine.setManualProgram(null);
    setManual(null);
  };
  const togglePip = (n: string) =>
    setPips((p) => (p.find((x) => x.name === n) ? p.filter((x) => x.name !== n) : [...p, { name: n, corner: 'tr' }]));
  const cyclePip = (n: string) =>
    setPips((p) => p.map((x) => (x.name === n ? { ...x, corner: nextCorner(x.corner) } : x)));
  const removePip = (n: string) => setPips((p) => p.filter((x) => x.name !== n));
  const onVolume = (v: number) => {
    setVolume(v);
    engine.setVolume(v);
  };
  const onConfig = (patch: Partial<SyncConfig>) => {
    engine.setConfig(patch);
    setCfg({ ...engine.config });
  };
  const onStrategy = (id: string) => {
    const s = strategies.find((x) => x.id === id);
    if (s) {
      engine.setStrategy(s);
      setStrategyId(id);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Mosaic <span className="brand-sub">synchronized multi-stream viewer</span>
        </div>
        <StatusBar />
        <div className="me">{name}</div>
      </header>

      <div className="stage">
        <main className="main-col">
          <ProgramView program={program} pips={pips} onCyclePip={cyclePip} onRemovePip={removePip} />
          <Controls
            strategies={strategies}
            strategyId={strategyId}
            onStrategy={onStrategy}
            manual={manual}
            onAuto={auto}
            volume={volume}
            onVolume={onVolume}
            config={cfg}
            onConfig={onConfig}
            onToggleHud={() => setShowHud((s) => !s)}
          />
        </main>

        <aside className="side-col">
          <section className="panel side-roster">
            <h2 className="panel-title">Feeds</h2>
            <Roster
              program={program}
              pips={pips.map((p) => p.name)}
              onSetProgram={setProgram}
              onTogglePip={togglePip}
            />
          </section>
          <section className="panel side-chat">
            <h2 className="panel-title">Chat</h2>
            <Chat />
          </section>
        </aside>
      </div>

      {showHud && <SyncHud onClose={() => setShowHud(false)} />}
    </div>
  );
}
