import { useState } from 'react';
import { useMosaic } from './context';

/** Simple display-name entry — no accounts for the prototype. Submitting is the
 *  user gesture we use to unlock audio playback (AudioContext.resume). */
export function NameGate({ onEnter }: { onEnter: (name: string) => void }) {
  const { connection, engine } = useMosaic();
  const [value, setValue] = useState(localStorage.getItem('mosaic-name') ?? '');

  const enter = () => {
    const name = value.trim().slice(0, 32) || `guest-${Math.floor(Math.random() * 9000 + 1000)}`;
    localStorage.setItem('mosaic-name', name);
    connection.setName(name);
    void engine.resumeAudio(); // gesture-gated
    onEnter(name);
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <h1 className="gate-title">Mosaic</h1>
        <p className="gate-sub">Synchronized multi-stream viewer</p>
        <label className="gate-label" htmlFor="name">
          Display name
        </label>
        <input
          id="name"
          className="gate-input"
          autoFocus
          value={value}
          maxLength={32}
          placeholder="e.g. casterAlex"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && enter()}
        />
        <button className="btn btn-primary gate-btn" onClick={enter}>
          Watch
        </button>
      </div>
    </div>
  );
}
