import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { cyberGlow } from './materials';

/**
 * 3D Holographic Particle Spire that hovers above the War Room Ideation table.
 * Displays floating orbiting particle dust, fiber-optic data rings, and spinning quantum octahedron.
 */
export function HolographicSpire({ position = [0, 0, 0] }: { position?: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const core = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  // Generate 48 swirling holographic ambient data particles
  const particleGeo = useMemo(() => {
    const count = 48;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const radius = 0.15 + Math.random() * 0.45;
      const y = -0.2 + Math.random() * 0.6;
      pos[i * 3] = Math.cos(theta) * radius;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = Math.sin(theta) * radius;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, []);

  useFrame((_, delta) => {
    const time = performance.now() * 0.001;
    if (ring1.current) {
      ring1.current.rotation.x = Math.PI / 2 + Math.sin(time * 1.5) * 0.2;
      ring1.current.rotation.y = time * 0.8;
    }
    if (ring2.current) {
      ring2.current.rotation.x = Math.PI / 2 + Math.cos(time * 1.2) * 0.25;
      ring2.current.rotation.y = -time * 0.9;
    }
    if (core.current) {
      core.current.rotation.y = time * 1.4;
      core.current.rotation.x = Math.sin(time * 2.0) * 0.2;
      core.current.position.y = 1.05 + Math.sin(time * 2.5) * 0.04;
    }
    if (particlesRef.current) {
      particlesRef.current.rotation.y = time * 0.35;
      const attr = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < 48; i++) {
        let y = arr[i * 3 + 1] + delta * 0.15;
        if (y > 0.45) y = -0.25;
        arr[i * 3 + 1] = y;
      }
      attr.needsUpdate = true;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Central Holographic Core Projector */}
      <mesh ref={core} position={[0, 1.05, 0]} material={cyberGlow('#38bdf8', 3.8)}>
        <octahedronGeometry args={[0.18]} />
      </mesh>

      {/* Orbiting Concentric Optical Pulse Rings */}
      <mesh ref={ring1} position={[0, 0.95, 0]} material={cyberGlow('#a855f7', 2.8)}>
        <ringGeometry args={[0.42, 0.45, 32]} />
      </mesh>
      <mesh ref={ring2} position={[0, 1.02, 0]} material={cyberGlow('#38bdf8', 2.4)}>
        <ringGeometry args={[0.54, 0.56, 32]} />
      </mesh>

      {/* Swirling Ambient Particle Cloud */}
      <points ref={particlesRef} geometry={particleGeo} position={[0, 1.0, 0]}>
        <pointsMaterial
          size={0.035}
          color="#60a5fa"
          transparent
          opacity={0.85}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </group>
  );
}

/**
 * Animated glowing pulse packets traversing 3D data pipeline splines in the office.
 * Demonstrates live data flow: Copilot -> Power Automate -> Dataverse.
 */
export function DataFlowPulseField({ position = [0, 0, 0] }: { position?: [number, number, number] }) {
  const p1 = useRef<THREE.Mesh>(null);
  const p2 = useRef<THREE.Mesh>(null);
  const p3 = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const t = (performance.now() * 0.0012) % 1; // 0 to 1 loop
    const t2 = (performance.now() * 0.0012 + 0.33) % 1;
    const t3 = (performance.now() * 0.0012 + 0.66) % 1;

    // Pulse traveling along X axis from -2.4 to 2.4 (east-west along wall board)
    if (p1.current) {
      p1.current.position.x = -2.4 + t * 4.8;
      p1.current.position.y = Math.sin(t * Math.PI) * 0.15;
    }
    if (p2.current) {
      p2.current.position.x = -2.4 + t2 * 4.8;
      p2.current.position.y = Math.sin(t2 * Math.PI) * 0.15;
    }
    if (p3.current) {
      p3.current.position.x = -2.4 + t3 * 4.8;
      p3.current.position.y = Math.sin(t3 * Math.PI) * 0.15;
    }
  });

  return (
    <group position={position}>
      <mesh ref={p1} material={cyberGlow('#38bdf8', 4.0)}>
        <sphereGeometry args={[0.045, 12, 12]} />
      </mesh>
      <mesh ref={p2} material={cyberGlow('#a855f7', 4.0)}>
        <sphereGeometry args={[0.045, 12, 12]} />
      </mesh>
      <mesh ref={p3} material={cyberGlow('#4ade80', 4.0)}>
        <sphereGeometry args={[0.045, 12, 12]} />
      </mesh>
    </group>
  );
}

/**
 * Animated subtle thermal steam rising from warm mugs on desks / kitchenette.
 */
export function CoffeeSteam({ position = [0, 0, 0] }: { position?: [number, number, number] }) {
  const pointsRef = useRef<THREE.Points>(null);
  const count = 16;

  const [geo] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 1] = Math.random() * 0.22;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return [g];
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += delta * 0.08;
      arr[i * 3] += Math.sin(performance.now() * 0.003 + i) * 0.001;
      if (arr[i * 3 + 1] > 0.25) {
        arr[i * 3 + 1] = 0;
        arr[i * 3] = (Math.random() - 0.5) * 0.04;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
      }
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} geometry={geo} position={position}>
      <pointsMaterial
        size={0.02}
        color="#e2e8f0"
        transparent
        opacity={0.35}
        depthWrite={false}
      />
    </points>
  );
}
