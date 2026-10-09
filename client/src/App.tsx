import { lazy, Suspense } from 'react';
import { useStore } from './store';
import { ConfirmDialog } from './ui/Confirm';
import { HUD } from './ui/HUD';
import { Overlays } from './ui/Overlays';
import { StartScreen } from './ui/StartScreen';
import { Tutorial } from './ui/Tutorial';
const Game = lazy(() => import('./world/Game').then((module) => ({ default: module.Game })));
const StatsReadout = lazy(() => import('./perf').then((module) => ({ default: module.StatsReadout })));
const statsEnabled = new URLSearchParams(location.search).has('stats');

export function App() {
  const started = useStore((state) => state.started);
  const worldReady = useStore((state) => state.worldReady);
  return (
    <>
      {started && <Suspense fallback={<div className="world-loading" role="status">Loading office…</div>}><Game /></Suspense>}
      {(!started || worldReady) && <HUD />}
      <Overlays />
      <Tutorial />
      <StartScreen />
      <ConfirmDialog />
      {started && statsEnabled && <Suspense fallback={null}><StatsReadout /></Suspense>}
    </>
  );
}
