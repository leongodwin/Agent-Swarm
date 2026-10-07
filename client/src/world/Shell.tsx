import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { ELEVATOR, HALF_D, HALF_W, WALL_H } from './layout';
import { drawSky } from './draw';
import { useCanvasTexture } from './interact';
import { glow, shade, toon } from './materials';
import { Box } from './Toon';

const WALL = '#fbf3e4';

function Window({ position, rotationY, width, seed }: { position: [number, number, number]; rotationY: number; width: number; seed: number }) {
  const tex = useCanvasTexture(512, 256, (ctx) => drawSky(ctx, 512, 256, seed), [seed]);
  const h = 1.8;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[width, h]} />
        <meshBasicMaterial map={tex} toneMapped={false} />
      </mesh>
      {/* frame + mullions */}
      <Box size={[width + 0.16, 0.1, 0.1]} position={[0, h / 2, 0.04]} color="#ffffff" outline shadow={false} />
      <Box size={[width + 0.16, 0.14, 0.18]} position={[0, -h / 2, 0.06]} color="#ffffff" outline shadow={false} />
      {[-width / 2, 0, width / 2].map((x) => (
        <Box key={x} size={[0.08, h, 0.1]} position={[x, 0, 0.04]} color="#ffffff" shadow={false} />
      ))}
    </group>
  );
}

function CeilingLight({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box size={[1.4, 0.06, 0.5]} position={[0, 0, 0]} color="#e9ecef" shadow={false} />
      <mesh position={[0, -0.035, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow('#fffbe8')}>
        <planeGeometry args={[1.25, 0.38]} />
      </mesh>
    </group>
  );
}

export function Shell({
  accent,
  floorColor,
  westWindows = [-8, 0, 8],
  eastWindows = [-8, 0],
  seed = 1,
}: {
  accent: string;
  floorColor: string;
  westWindows?: number[];
  eastWindows?: number[];
  seed?: number;
}) {
  const wall = toon(WALL);
  const t = 0.3;
  const { doorHalf, doorHeight } = ELEVATOR;
  const lights = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = -12; x <= 12; x += 6) for (let z = -8; z <= 8; z += 5.5) out.push([x, WALL_H - 0.04, z]);
    return out;
  }, []);
  const floorTex = useMemo(() => {
    // High-resolution Scandinavian herringbone architectural oak floor
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d')!;

    // Base background warm tone
    ctx.fillStyle = floorColor;
    ctx.fillRect(0, 0, 1024, 1024);

    const plankW = 128;
    const plankH = 32;

    // Herringbone zigzag pattern
    for (let y = 0; y < 1024; y += plankH) {
      for (let x = 0; x < 1024; x += plankW) {
        const alt = Math.floor(y / plankH) % 2 === 0;
        const toneVar = ((x * 13 + y * 7) % 11) * 0.008 - 0.04;
        ctx.fillStyle = shade(floorColor, toneVar);
        ctx.fillRect(x + (alt ? plankW / 2 : 0), y, plankW, plankH);

        // Subtle realistic wood grain streaks
        ctx.fillStyle = shade(floorColor, toneVar - 0.025);
        for (let g = 0; g < 3; g++) {
          ctx.fillRect(x + (alt ? plankW / 2 : 0) + 12 + g * 35, y + 8 + g * 7, 45, 1.5);
        }

        // Crisp architectural micro-bevel gap
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        ctx.fillRect(x + (alt ? plankW / 2 : 0), y + plankH - 1.5, plankW, 1.5);
        ctx.fillRect(x + (alt ? plankW / 2 : 0) + plankW - 1.5, y, 1.5, plankH);
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 4.5);
    tex.anisotropy = 16;
    return tex;
  }, [floorColor]);

  const southSeg = HALF_W - doorHalf;
  return (
    <group>
      {/* floor + ceiling with architectural PBR surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HALF_W * 2, HALF_D * 2]} />
        <meshStandardMaterial map={floorTex} roughness={0.34} metalness={0.03} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, WALL_H, 0]} material={toon('#f8fafc')}>
        <planeGeometry args={[HALF_W * 2, HALF_D * 2]} />
      </mesh>
      {lights.map((p) => (
        <CeilingLight key={p.join()} position={p} />
      ))}

      {/* walls */}
      <mesh position={[0, WALL_H / 2, -HALF_D - t / 2]} material={wall} receiveShadow>
        <boxGeometry args={[HALF_W * 2 + t * 2, WALL_H, t]} />
      </mesh>
      <mesh position={[-HALF_W - t / 2, WALL_H / 2, 0]} material={wall} receiveShadow>
        <boxGeometry args={[t, WALL_H, HALF_D * 2]} />
      </mesh>
      <mesh position={[HALF_W + t / 2, WALL_H / 2, 0]} material={wall} receiveShadow>
        <boxGeometry args={[t, WALL_H, HALF_D * 2]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (doorHalf + southSeg / 2), WALL_H / 2, HALF_D + t / 2]} material={wall} receiveShadow>
          <boxGeometry args={[southSeg, WALL_H, t]} />
        </mesh>
      ))}
      <mesh position={[0, (WALL_H + doorHeight) / 2, HALF_D + t / 2]} material={wall}>
        <boxGeometry args={[doorHalf * 2, WALL_H - doorHeight, t]} />
      </mesh>

      {/* skirting + accent stripe */}
      {[
        { p: [0, 0, -HALF_D + 0.02] as const, r: 0, w: HALF_W * 2 },
        { p: [-HALF_W + 0.02, 0, 0] as const, r: Math.PI / 2, w: HALF_D * 2 },
        { p: [HALF_W - 0.02, 0, 0] as const, r: -Math.PI / 2, w: HALF_D * 2 },
        { p: [-(doorHalf + southSeg / 2), 0, HALF_D - 0.02] as const, r: Math.PI, w: southSeg },
        { p: [doorHalf + southSeg / 2, 0, HALF_D - 0.02] as const, r: Math.PI, w: southSeg },
      ].map(({ p, r, w }, i) => (
        <group key={i} position={[p[0], 0, p[2]]} rotation={[0, r, 0]}>
          <mesh position={[0, 0.06, 0]} material={toon(shade(accent, -0.2))}>
            <boxGeometry args={[w, 0.12, 0.04]} />
          </mesh>
          <mesh position={[0, 0.95, 0]} material={toon(accent)}>
            <boxGeometry args={[w, 0.12, 0.03]} />
          </mesh>
        </group>
      ))}

      {westWindows.map((z, i) => (
        <Window key={`w${z}`} position={[-HALF_W + 0.02, 1.95, z]} rotationY={Math.PI / 2} width={5.5} seed={seed * 3 + i} />
      ))}
      {eastWindows.map((z, i) => (
        <Window key={`e${z}`} position={[HALF_W - 0.02, 1.95, z]} rotationY={-Math.PI / 2} width={5.5} seed={seed * 5 + i + 7} />
      ))}
    </group>
  );
}

export function Lights() {
  const lightMode = useStore((s) => s.lightMode);
  const keynote = lightMode === 'keynote';

  return (
    <>
      <hemisphereLight args={keynote ? ['#1e1b4b', '#0f172a', 0.45] : ['#ffffff', '#cbd5e1', 0.85]} />
      <ambientLight intensity={keynote ? 0.15 : 0.25} />
      {/* Warm natural sun through windows or moody keynote spotlight */}
      <directionalLight
        position={[10, 15, 8]}
        intensity={keynote ? 0.6 : 1.75}
        color={keynote ? '#818cf8' : '#fffbf2'}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={42}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={3.5}
      />
      {/* Soft blue / purple ambient fill */}
      <directionalLight
        position={[-12, 10, -6]}
        intensity={keynote ? 0.85 : 0.4}
        color={keynote ? '#c084fc' : '#38bdf8'}
      />
    </>
  );
}
