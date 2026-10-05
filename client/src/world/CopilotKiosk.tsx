import { useRef } from 'react';
import * as THREE from 'three';
import { useInteractable } from './interact';
import { Box, Cyl, Ball } from './Toon';
import { FluentIconMesh } from './FluentIcons';
import { glow } from './materials';

/**
 * 3D Interactive Copilot Studio Test Kiosk.
 * Placed in the lobby and office floors: provides an interactive prompt "Press E to test Copilot Studio".
 * Interacting triggers the CopilotChatOverlay modal.
 */
export function CopilotKiosk({
  position,
  rotationY = 0,
}: {
  position: [number, number, number];
  rotationY?: number;
}) {
  const ref = useInteractable<THREE.Group>(
    {
      id: 'copilot-studio-kiosk',
      label: 'Press E to test the Copilot Studio agent',
      action: { kind: 'copilot' },
    },
    3.4,
  );

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      {/* Heavy Pedestal Base */}
      <Cyl r={0.42} rTop={0.36} h={0.12} position={[0, 0.06, 0]} color="#1e293b" outline />
      <Cyl r={0.14} h={0.9} position={[0, 0.55, 0]} color="#334155" />

      {/* Futuristic Angular Console Head */}
      <group position={[0, 1.05, 0.05]} rotation={[-Math.PI / 6, 0, 0]}>
        {/* Main tablet housing */}
        <Box size={[0.72, 0.52, 0.08]} position={[0, 0, 0]} color="#0f172a" outline />
        {/* Glowing glass touch display screen */}
        <mesh position={[0, 0, 0.045]}>
          <planeGeometry args={[0.66, 0.46]} />
          <meshBasicMaterial color="#0078D4" />
        </mesh>
        {/* Inner screen detail */}
        <mesh position={[0, 0, 0.047]}>
          <planeGeometry args={[0.62, 0.42]} />
          <meshBasicMaterial color="#1e1b4b" />
        </mesh>

        {/* 3D Copilot Studio Emblem on top of the console */}
        <FluentIconMesh name="copilot" size={0.28} position={[0, 0.02, 0.052]} />

        {/* LED Activity Pulse on bottom edge */}
        <mesh position={[0, -0.21, 0.045]} material={glow('#38BDF8')}>
          <boxGeometry args={[0.4, 0.015, 0.01]} />
        </mesh>
      </group>

      {/* Floating Status Ring Indicator */}
      <mesh position={[0, 1.48, 0.05]} material={glow('#C084FC')}>
        <torusGeometry args={[0.08, 0.012, 8, 24]} />
      </mesh>
    </group>
  );
}
