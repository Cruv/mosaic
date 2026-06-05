import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadConfig, whepUrl } from './config';
import { MosaicConnection } from './net/connection';
import { SyncEngine } from './sync/syncEngine';
import { MosaicProvider } from './ui/context';
import { App } from './App';
import './index.css';

async function boot() {
  const cfg = await loadConfig();

  // Singletons created OUTSIDE React so StrictMode/remounts never recreate them.
  const connection = new MosaicConnection(cfg.wsUrl);
  const engine = new SyncEngine(connection.time, whepUrl);

  // Drive feed lifecycle from the roster (drop-in / drop-out).
  connection.on('roster', (feeds) => engine.setRoster(feeds.map((f) => f.name)));

  connection.connect();
  engine.start();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MosaicProvider connection={connection} engine={engine}>
        <App />
      </MosaicProvider>
    </StrictMode>,
  );
}

void boot();
