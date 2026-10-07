import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useInteractable } from './interact';
import { Box, Cyl } from './Toon';
import { glow, cyberGlow } from './materials';

/**
 * 3D Interactive ALM Multi-Environment Release Station.
 * Located on the office floor: displays Dev, Test, Prod pipeline towers
 * and a glowing amber signoff beacon when a release is awaiting manager approval.
 * Interacting opens the ReleasePipelineModal.
 */
export function ReleaseApprovalStation({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const beaconRef = useRef<THREE.Mesh>(null);
  const ref = useInteractable<THREE.Group>(
    {
      id: 'alm-release-station',
      label: 'Review ALM Multi-Environment Release & Signoff Production (E)',
      action: { kind: 'alm-kiosk' },
    },
    3.5,
  );

  useFrame(({ clock }) => {
    if (beaconRef.current) {
      const t = clock.getElapsedTime();
      beaconRef.current.rotation.y = t * 1.5;
      beaconRef.current.position.y = 1.65 + Math.sin(t * 3) * 0.05;
    }
  });

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Heavy Plinth / Base */}
      <Box size={[1.6, 0.14, 0.9]} position={[0, 0.07, 0]} color="#0f172a" outline />
      <Box size={[1.48, 0.06, 0.78]} position={[0, 0.17, 0]} color="#1e293b" outline />

      {/* Central Command Pedestal Column */}
      <Cyl r={0.24} h={0.7} position={[0, 0.55, 0]} color="#334155" outline />

      {/* 3 Holographic Tier Pillars: DEV, TEST, PROD */}
      {/* 1. DEV (Indigo) */}
      <group position={[-0.45, 0.7, 0]}>
        <Cyl r={0.1} h={0.5} position={[0, 0, 0]} color="#1e1b4b" outline />
        <mesh position={[0, 0.32, 0]} material={cyberGlow('#6366f1', 1.8)}>
          <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
        </mesh>
        <mesh position={[0, -0.22, 0.11]} material={glow('#818cf8')}>
          <boxGeometry args={[0.18, 0.02, 0.01]} />
        </mesh>
      </group>

      {/* 2. TEST (Cyan) */}
      <group position={[0, 0.85, 0.05]}>
        <Cyl r={0.12} h={0.7} position={[0, 0, 0]} color="#082f49" outline />
        <mesh position={[0, 0.42, 0]} material={cyberGlow('#38bdf8', 2.2)}>
          <cylinderGeometry args={[0.08, 0.08, 0.14, 16]} />
        </mesh>
        <mesh position={[0, -0.32, 0.13]} material={glow('#38bdf8')}>
          <boxGeometry args={[0.2, 0.02, 0.01]} />
        </mesh>
      </group>

      {/* 3. PROD (Emerald) */}
      <group position={[0.45, 0.7, 0]}>
        <Cyl r={0.1} h={0.5} position={[0, 0, 0]} color="#064e3b" outline />
        <mesh position={[0, 0.32, 0]} material={cyberGlow('#10b981', 2.0)}>
          <cylinderGeometry args={[0.07, 0.07, 0.12, 16]} />
        </mesh>
        <mesh position={[0, -0.22, 0.11]} material={glow('#34d399')}>
          <boxGeometry args={[0.18, 0.02, 0.01]} />
        </mesh>
      </group>

      {/* Floating Manager Signoff Beacon (Octahedron diamond) */}
      <mesh ref={beaconRef} position={[0, 1.65, 0]} material={glow('#f59e0b')}>
        <octahedronGeometry args={[0.14, 0]} />
      </mesh>

      {/* Holographic Ring pulsing below the beacon */}
      <mesh position={[0, 1.45, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow('#fbbf24')}>
        <ringGeometry args={[0.22, 0.25, 32]} />
      </mesh>

      {/* Console Interface Screen / Touchpad angled toward the user */}
      <group position={[0, 0.98, 0.28]} rotation={[-0.45, 0, 0]}>
        <Box size={[0.62, 0.38, 0.04]} position={[0, 0, 0]} color="#020617" outline />
        <mesh position={[0, 0, 0.025]}>
          <planeGeometry args={[0.56, 0.32]} />
          <meshBasicMaterial color="#047857" />
        </mesh>
        {/* Terminal readout display */}
        <mesh position={[0, 0, 0.027]}>
          <planeGeometry args={[0.52, 0.28]} />
          <meshBasicMaterial color="#0f172a" />
        </mesh>
        <mesh position={[0, -0.1, 0.029]} material={glow('#34d399')}>
          <boxGeometry args={[0.3, 0.015, 0.01]} />
        </mesh>
      </group>
    </group>
  );
}
