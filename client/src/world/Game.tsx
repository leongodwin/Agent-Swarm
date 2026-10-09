import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { AdaptiveResolution, FrameWhilePaused, MAX_DPR, StatsProbe, statsEnabled, useRenderPaused } from '../perf';
import { repoOnFloor, useStore } from '../store';
import { ding, whoosh } from '../ui/sfx';
import { lobbyColliders, officeColliders } from './layout';
import { Lobby } from './Lobby';
import { OfficeFloor } from './OfficeFloor';
import { Player } from './Player';
import { Lights } from './Shell';
import { useVisualPrefs, reducedMotion } from '../visualPrefs';

function Travel() {
  const travel = useStore((s) => s.travel);
  const finish = useStore((s) => s.finishTravel);
  useEffect(() => {
    if (!travel) return;
    if (travel.phase === 'closing') whoosh(0.75);
    const t = setTimeout(
      () => {
        if (travel.phase === 'closing') {
          finish('arrived');
          ding();
        } else finish('done');
      },
      reducedMotion() ? 0 : travel.phase === 'closing' ? 750 : 650,
    );
    return () => clearTimeout(t);
  }, [travel, finish]);
  return null;
}

export function Game() {
  const low = useVisualPrefs((state) => state.quality === 'low');
  const floor = useStore((s) => s.floor);
  const repos = useStore((s) => s.repos);
  const lightMode = useStore((s) => s.lightMode);
  const keynote = lightMode === 'keynote';
  const repo = floor === 0 ? null : repoOnFloor(repos, floor);
  const isOffice = !!repo;
  const colliders = useMemo(() => (isOffice ? officeColliders() : lobbyColliders()), [isOffice]);
  // Stop drawing while nobody can see the office; switching back to 'always' draws a fresh frame at once.
  const paused = useRenderPaused();
  const [maxDpr, setMaxDpr] = useState(MAX_DPR);

  return (
    <Canvas
      shadows={!low}
      frameloop={paused ? 'never' : 'always'}
      dpr={[1, low ? 1 : maxDpr]}
      camera={{ fov: 72, near: 0.05, far: 90, position: [0, 1.65, 10] }}
      gl={{ antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = keynote ? 1.15 : 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <color attach="background" args={[keynote ? '#090d16' : '#bfe3ff']} />
      <fog attach="fog" args={[keynote ? '#0f172a' : '#f3ece2', 30, keynote ? 55 : 70]} />
      <Lights />
      <Suspense fallback={null}>{repo ? <OfficeFloor key={repo.id} repo={repo} /> : <Lobby />}</Suspense>
      <Player colliders={colliders} floor={floor} />
      <Travel />
      <FrameWhilePaused paused={paused} />
      <AdaptiveResolution onChange={setMaxDpr} />
      {statsEnabled && <StatsProbe paused={paused} />}
      {!low && <EffectComposer multisampling={0}>
        <Bloom
          luminanceThreshold={0.88}
          luminanceSmoothing={0.3}
          intensity={keynote ? 1.6 : 0.85}
          mipmapBlur
        />
        <Vignette eskil={false} offset={0.15} darkness={keynote ? 0.65 : 0.25} />
      </EffectComposer>}
    </Canvas>
  );
}
