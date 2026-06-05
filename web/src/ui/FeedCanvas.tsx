import { useEffect, useRef } from 'react';
import { useMosaic } from './context';

/**
 * A canvas surface the sync engine draws into. The engine owns the draw loop;
 * this component just hands it a canvas and a feed name, and keeps them
 * registered. Changing `feedName` re-registers (so the program surface can
 * follow whichever feed is currently program).
 */
export function FeedCanvas({
  surfaceId,
  feedName,
  className,
}: {
  surfaceId: string;
  feedName: string | null;
  className?: string;
}) {
  const { engine } = useMosaic();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !feedName) return;
    engine.registerSurface(surfaceId, c, feedName);
    return () => engine.unregisterSurface(surfaceId);
  }, [engine, surfaceId, feedName]);

  return <canvas ref={ref} className={className} />;
}
