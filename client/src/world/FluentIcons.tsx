import * as THREE from 'three';
import { roundRect, SANS } from './draw';
import { useCanvasTexture } from './interact';

export type FluentIconName =
  | 'copilot'
  | 'powerplatform'
  | 'powerapps'
  | 'powerautomate'
  | 'powerbi'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'teams'
  | 'azure'
  | 'microsoft';

export interface FluentIconConfig {
  name: FluentIconName;
  label: string;
  category: 'office' | 'powerplatform' | 'ai';
  primaryColor: string;
  secondaryColor?: string;
  draw: (ctx: CanvasRenderingContext2D, size: number) => void;
}

/**
 * High quality canvas rendering for Microsoft Fluent 2 UI styled icons.
 * Features Fluent-characteristic geometry, rounded squircle tiles, subtle bevels,
 * vibrant gradient layering, and crisp 3D cartoon office aesthetic.
 */
function drawFluentSquircle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fillGrad: CanvasGradient | string) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fillGrad;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fill();
  ctx.restore();

  // Subtle inner highlight border (Fluent 2 style subtle illumination)
  ctx.save();
  roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, r - 2));
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();
  ctx.restore();
}

export const FLUENT_ICONS: Record<FluentIconName, FluentIconConfig> = {
  copilot: {
    name: 'copilot',
    label: 'Copilot Studio',
    category: 'ai',
    primaryColor: '#0078D4',
    secondaryColor: '#5C2D91',
    draw: (ctx, s) => {
      // Fluent Copilot multi-colored flowing ribbon loop
      const cx = s / 2;
      const cy = s / 2;

      // Glow background halo
      const radial = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s * 0.45);
      radial.addColorStop(0, 'rgba(0, 164, 239, 0.25)');
      radial.addColorStop(1, 'rgba(119, 74, 224, 0)');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, s, s);

      // Ribbon gradient 1 (cyan to royal blue)
      const grad1 = ctx.createLinearGradient(s * 0.2, s * 0.2, s * 0.8, s * 0.5);
      grad1.addColorStop(0, '#00C8F8');
      grad1.addColorStop(0.5, '#0078D4');
      grad1.addColorStop(1, '#6B42CA');

      // Ribbon gradient 2 (purple to pink/coral)
      const grad2 = ctx.createLinearGradient(s * 0.2, s * 0.6, s * 0.8, s * 0.8);
      grad2.addColorStop(0, '#5C2D91');
      grad2.addColorStop(0.6, '#B13589');
      grad2.addColorStop(1, '#FF6B6B');

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Back loop
      ctx.beginPath();
      ctx.moveTo(s * 0.28, s * 0.65);
      ctx.bezierCurveTo(s * 0.15, s * 0.45, s * 0.25, s * 0.22, s * 0.48, s * 0.22);
      ctx.bezierCurveTo(s * 0.72, s * 0.22, s * 0.85, s * 0.42, s * 0.76, s * 0.68);
      ctx.strokeStyle = grad1;
      ctx.lineWidth = s * 0.15;
      ctx.stroke();

      // Front cross loop
      ctx.beginPath();
      ctx.moveTo(s * 0.74, s * 0.4);
      ctx.bezierCurveTo(s * 0.86, s * 0.65, s * 0.72, s * 0.82, s * 0.52, s * 0.82);
      ctx.bezierCurveTo(s * 0.3, s * 0.82, s * 0.18, s * 0.62, s * 0.32, s * 0.36);
      ctx.strokeStyle = grad2;
      ctx.lineWidth = s * 0.13;
      ctx.stroke();

      // Sparkling AI stars
      ctx.fillStyle = '#FFFFFF';
      const drawSparkle = (x: number, y: number, r: number) => {
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.quadraticCurveTo(x, y, x, y + r);
        ctx.quadraticCurveTo(x, y, x - r, y);
        ctx.quadraticCurveTo(x, y, x, y - r);
        ctx.fill();
      };
      drawSparkle(s * 0.5, s * 0.5, s * 0.12);
      drawSparkle(s * 0.78, s * 0.24, s * 0.07);
      drawSparkle(s * 0.24, s * 0.76, s * 0.06);

      ctx.restore();
    },
  },

  powerplatform: {
    name: 'powerplatform',
    label: 'Power Platform',
    category: 'powerplatform',
    primaryColor: '#742774',
    secondaryColor: '#9B2C9B',
    draw: (ctx, s) => {
      // Iconic Fluent Power Platform multi-colored chevron / gemstone
      const cx = s / 2;
      const cy = s / 2;

      // Outer soft rounded tile
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#531b53');
      bgGrad.addColorStop(1, '#812481');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      // Quadrants / faceted wings
      const drawFacet = (pts: [number, number][], fill: string) => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      };

      // Top wing
      drawFacet(
        [
          [cx, cy - s * 0.28],
          [cx + s * 0.26, cy - s * 0.08],
          [cx, cy + s * 0.04],
          [cx - s * 0.26, cy - s * 0.08],
        ],
        '#d94fd9',
      );

      // Left wing (darker violet)
      drawFacet(
        [
          [cx - s * 0.26, cy - s * 0.08],
          [cx, cy + s * 0.04],
          [cx - s * 0.18, cy + s * 0.28],
        ],
        '#9e2f9e',
      );

      // Right wing (bright magenta)
      drawFacet(
        [
          [cx + s * 0.26, cy - s * 0.08],
          [cx, cy + s * 0.04],
          [cx + s * 0.18, cy + s * 0.28],
        ],
        '#f36cf3',
      );

      // Bottom chevron tip
      drawFacet(
        [
          [cx, cy + s * 0.04],
          [cx - s * 0.18, cy + s * 0.28],
          [cx, cy + s * 0.22],
          [cx + s * 0.18, cy + s * 0.28],
        ],
        '#c437c4',
      );
    },
  },

  powerapps: {
    name: 'powerapps',
    label: 'Power Apps',
    category: 'powerplatform',
    primaryColor: '#742774',
    draw: (ctx, s) => {
      // Power Apps stylized 'P' chevron in Fluent violet
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#5a135a');
      bgGrad.addColorStop(1, '#8e1b8e');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      // Left back purple block
      ctx.fillStyle = '#a62aa6';
      roundRect(ctx, s * 0.24, s * 0.22, s * 0.32, s * 0.56, s * 0.06);
      ctx.fill();

      // Front bright facet
      const fgGrad = ctx.createLinearGradient(s * 0.3, s * 0.2, s * 0.76, s * 0.6);
      fgGrad.addColorStop(0, '#f574f5');
      fgGrad.addColorStop(1, '#ca30ca');
      ctx.fillStyle = fgGrad;
      ctx.beginPath();
      ctx.moveTo(s * 0.38, s * 0.22);
      ctx.lineTo(s * 0.68, s * 0.22);
      ctx.bezierCurveTo(s * 0.82, s * 0.22, s * 0.82, s * 0.52, s * 0.68, s * 0.52);
      ctx.lineTo(s * 0.38, s * 0.52);
      ctx.closePath();
      ctx.fill();

      // Window cut
      ctx.fillStyle = '#5a135a';
      roundRect(ctx, s * 0.46, s * 0.32, s * 0.14, s * 0.1, s * 0.02);
      ctx.fill();
    },
  },

  powerautomate: {
    name: 'powerautomate',
    label: 'Power Automate',
    category: 'powerplatform',
    primaryColor: '#0066FF',
    draw: (ctx, s) => {
      // Fluent Power Automate overlapping blue/cyan wings
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#004cbf');
      bgGrad.addColorStop(1, '#0078d4');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      // Top chevron (cyan)
      ctx.fillStyle = '#50e6ff';
      ctx.beginPath();
      ctx.moveTo(s * 0.24, s * 0.32);
      ctx.lineTo(s * 0.48, s * 0.54);
      ctx.lineTo(s * 0.36, s * 0.66);
      ctx.lineTo(s * 0.24, s * 0.54);
      ctx.closePath();
      ctx.fill();

      // Middle wing (fluent blue)
      ctx.fillStyle = '#00bcff';
      ctx.beginPath();
      ctx.moveTo(s * 0.48, s * 0.54);
      ctx.lineTo(s * 0.76, s * 0.32);
      ctx.lineTo(s * 0.76, s * 0.48);
      ctx.lineTo(s * 0.48, s * 0.7);
      ctx.closePath();
      ctx.fill();

      // Bottom return wing
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(s * 0.36, s * 0.66);
      ctx.lineTo(s * 0.48, s * 0.7);
      ctx.lineTo(s * 0.62, s * 0.58);
      ctx.lineTo(s * 0.52, s * 0.48);
      ctx.closePath();
      ctx.fill();
    },
  },

  powerbi: {
    name: 'powerbi',
    label: 'Power BI',
    category: 'powerplatform',
    primaryColor: '#F2C811',
    draw: (ctx, s) => {
      // Fluent Power BI bars in warm yellow/gold/black
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#262626');
      bgGrad.addColorStop(1, '#3a3a3a');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      const r = s * 0.04;
      // Bar 1 (left shortest)
      ctx.fillStyle = '#8a6d0b';
      roundRect(ctx, s * 0.26, s * 0.52, s * 0.13, s * 0.26, r);
      ctx.fill();

      // Bar 2 (middle)
      ctx.fillStyle = '#d4a106';
      roundRect(ctx, s * 0.43, s * 0.36, s * 0.14, s * 0.42, r);
      ctx.fill();

      // Bar 3 (right tallest, bright gold)
      const goldGrad = ctx.createLinearGradient(0, s * 0.22, 0, s * 0.78);
      goldGrad.addColorStop(0, '#fff066');
      goldGrad.addColorStop(1, '#f2c811');
      ctx.fillStyle = goldGrad;
      roundRect(ctx, s * 0.61, s * 0.22, s * 0.15, s * 0.56, r);
      ctx.fill();
    },
  },

  word: {
    name: 'word',
    label: 'Word',
    category: 'office',
    primaryColor: '#185ABD',
    draw: (ctx, s) => {
      // Fluent Office Word tile: right page layers + left 'W' tile
      const bgGrad = ctx.createLinearGradient(s * 0.3, s * 0.15, s * 0.85, s * 0.85);
      bgGrad.addColorStop(0, '#103f91');
      bgGrad.addColorStop(1, '#185abd');

      // Right back document card
      drawFluentSquircle(ctx, s * 0.32, s * 0.18, s * 0.56, s * 0.64, s * 0.12, bgGrad);

      // Document lines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      roundRect(ctx, s * 0.55, s * 0.32, s * 0.24, s * 0.05, 3);
      ctx.fill();
      roundRect(ctx, s * 0.55, s * 0.43, s * 0.24, s * 0.05, 3);
      ctx.fill();
      roundRect(ctx, s * 0.55, s * 0.54, s * 0.18, s * 0.05, 3);
      ctx.fill();

      // Left floating 'W' squircle
      const frontGrad = ctx.createLinearGradient(s * 0.12, s * 0.28, s * 0.55, s * 0.72);
      frontGrad.addColorStop(0, '#2b7cd3');
      frontGrad.addColorStop(1, '#104a9e');
      drawFluentSquircle(ctx, s * 0.12, s * 0.28, s * 0.44, s * 0.44, s * 0.1, frontGrad);

      // White 'W'
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${s * 0.26}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('W', s * 0.34, s * 0.51);
    },
  },

  excel: {
    name: 'excel',
    label: 'Excel',
    category: 'office',
    primaryColor: '#107C41',
    draw: (ctx, s) => {
      // Fluent Office Excel tile
      const bgGrad = ctx.createLinearGradient(s * 0.3, s * 0.15, s * 0.85, s * 0.85);
      bgGrad.addColorStop(0, '#0e5c32');
      bgGrad.addColorStop(1, '#107c41');

      drawFluentSquircle(ctx, s * 0.32, s * 0.18, s * 0.56, s * 0.64, s * 0.12, bgGrad);

      // Grid table preview
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      roundRect(ctx, s * 0.52, s * 0.3, s * 0.28, s * 0.4, 4);
      ctx.fill();
      ctx.strokeStyle = '#0e5c32';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s * 0.66, s * 0.3);
      ctx.lineTo(s * 0.66, s * 0.7);
      ctx.moveTo(s * 0.52, s * 0.5);
      ctx.lineTo(s * 0.8, s * 0.5);
      ctx.stroke();

      // Front 'X' tile
      const frontGrad = ctx.createLinearGradient(s * 0.12, s * 0.28, s * 0.55, s * 0.72);
      frontGrad.addColorStop(0, '#1cb059');
      frontGrad.addColorStop(1, '#0b6a36');
      drawFluentSquircle(ctx, s * 0.12, s * 0.28, s * 0.44, s * 0.44, s * 0.1, frontGrad);

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${s * 0.26}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('X', s * 0.34, s * 0.51);
    },
  },

  powerpoint: {
    name: 'powerpoint',
    label: 'PowerPoint',
    category: 'office',
    primaryColor: '#C43E1C',
    draw: (ctx, s) => {
      // Fluent Office PowerPoint tile
      const bgGrad = ctx.createLinearGradient(s * 0.3, s * 0.15, s * 0.85, s * 0.85);
      bgGrad.addColorStop(0, '#982b10');
      bgGrad.addColorStop(1, '#c43e1c');

      drawFluentSquircle(ctx, s * 0.32, s * 0.18, s * 0.56, s * 0.64, s * 0.12, bgGrad);

      // Pie chart icon on the right
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(s * 0.66, s * 0.5, s * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd6cc';
      ctx.beginPath();
      ctx.moveTo(s * 0.66, s * 0.5);
      ctx.arc(s * 0.66, s * 0.5, s * 0.14, -Math.PI / 2, Math.PI * 0.2);
      ctx.closePath();
      ctx.fill();

      // Front 'P' tile
      const frontGrad = ctx.createLinearGradient(s * 0.12, s * 0.28, s * 0.55, s * 0.72);
      frontGrad.addColorStop(0, '#ed5a36');
      frontGrad.addColorStop(1, '#a62e11');
      drawFluentSquircle(ctx, s * 0.12, s * 0.28, s * 0.44, s * 0.44, s * 0.1, frontGrad);

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${s * 0.26}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', s * 0.34, s * 0.51);
    },
  },

  teams: {
    name: 'teams',
    label: 'Microsoft Teams',
    category: 'office',
    primaryColor: '#464EB8',
    draw: (ctx, s) => {
      // Fluent Teams: avatar silhouettes + 'T' squircle
      const bgGrad = ctx.createLinearGradient(s * 0.3, s * 0.15, s * 0.85, s * 0.85);
      bgGrad.addColorStop(0, '#33377d');
      bgGrad.addColorStop(1, '#5059c9');

      drawFluentSquircle(ctx, s * 0.32, s * 0.18, s * 0.56, s * 0.64, s * 0.12, bgGrad);

      // Avatars
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.arc(s * 0.66, s * 0.38, s * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * 0.66, s * 0.64, s * 0.14, Math.PI, 0);
      ctx.fill();

      // Front 'T' tile
      const frontGrad = ctx.createLinearGradient(s * 0.12, s * 0.28, s * 0.55, s * 0.72);
      frontGrad.addColorStop(0, '#6264a7');
      frontGrad.addColorStop(1, '#3d3e74');
      drawFluentSquircle(ctx, s * 0.12, s * 0.28, s * 0.44, s * 0.44, s * 0.1, frontGrad);

      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${s * 0.26}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('T', s * 0.34, s * 0.51);
    },
  },

  azure: {
    name: 'azure',
    label: 'Microsoft Azure',
    category: 'ai',
    primaryColor: '#0078D4',
    draw: (ctx, s) => {
      // Azure iconic folded polygon
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#004c87');
      bgGrad.addColorStop(1, '#0078d4');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      // Azure A-shape facets
      ctx.fillStyle = '#005ba1';
      ctx.beginPath();
      ctx.moveTo(s * 0.26, s * 0.74);
      ctx.lineTo(s * 0.46, s * 0.26);
      ctx.lineTo(s * 0.6, s * 0.26);
      ctx.lineTo(s * 0.42, s * 0.74);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#50e6ff';
      ctx.beginPath();
      ctx.moveTo(s * 0.52, s * 0.46);
      ctx.lineTo(s * 0.74, s * 0.74);
      ctx.lineTo(s * 0.38, s * 0.74);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#00a4ef';
      ctx.beginPath();
      ctx.moveTo(s * 0.46, s * 0.26);
      ctx.lineTo(s * 0.62, s * 0.26);
      ctx.lineTo(s * 0.74, s * 0.74);
      ctx.lineTo(s * 0.58, s * 0.74);
      ctx.closePath();
      ctx.fill();
    },
  },

  microsoft: {
    name: 'microsoft',
    label: 'Microsoft AI',
    category: 'ai',
    primaryColor: '#00A4EF',
    draw: (ctx, s) => {
      // Microsoft 4-color square logo inside fluent squircle
      const bgGrad = ctx.createLinearGradient(0, 0, s, s);
      bgGrad.addColorStop(0, '#1e2430');
      bgGrad.addColorStop(1, '#2d3748');
      drawFluentSquircle(ctx, s * 0.08, s * 0.08, s * 0.84, s * 0.84, s * 0.2, bgGrad);

      const qw = s * 0.24;
      const gap = s * 0.04;
      const x1 = s * 0.24;
      const x2 = x1 + qw + gap;
      const y1 = s * 0.24;
      const y2 = y1 + qw + gap;
      const r = 4;

      // Red (top left)
      ctx.fillStyle = '#f25022';
      roundRect(ctx, x1, y1, qw, qw, r);
      ctx.fill();

      // Green (top right)
      ctx.fillStyle = '#7fba00';
      roundRect(ctx, x2, y1, qw, qw, r);
      ctx.fill();

      // Blue (bottom left)
      ctx.fillStyle = '#00a4ef';
      roundRect(ctx, x1, y2, qw, qw, r);
      ctx.fill();

      // Yellow (bottom right)
      ctx.fillStyle = '#ffb900';
      roundRect(ctx, x2, y2, qw, qw, r);
      ctx.fill();
    },
  },
};

/**
 * 3D Fluent UI Icon Plaque / Display Widget for the 3D office world
 */
export function FluentIconMesh({
  name,
  size = 0.5,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  showLabel = false,
}: {
  name: FluentIconName;
  size?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  showLabel?: boolean;
}) {
  const icon = FLUENT_ICONS[name] || FLUENT_ICONS.microsoft;
  const resolution = 256;

  const texture = useCanvasTexture(
    resolution,
    showLabel ? resolution + 70 : resolution,
    (ctx) => {
      ctx.clearRect(0, 0, resolution, showLabel ? resolution + 70 : resolution);
      icon.draw(ctx, resolution);

      if (showLabel) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 24px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;
        ctx.fillText(icon.label, resolution / 2, resolution + 8);
      }
    },
    [name, showLabel],
  );

  const planeH = showLabel ? size * 1.25 : size;

  return (
    <group position={position} rotation={rotation}>
      {/* Acrylic / glass base backing */}
      <mesh position={[0, 0, -0.015]}>
        <boxGeometry args={[size * 1.08, planeH * 1.08, 0.02]} />
        <meshPhysicalMaterial
          color="#ffffff"
          roughness={0.15}
          transmission={0.65}
          thickness={0.05}
          transparent
          opacity={0.85}
        />
      </mesh>
      {/* Icon face */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[size, planeH]} />
        <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * Fluent UI Feature Wall Banner displaying Microsoft AI, Copilot Studio, and Power Platform
 */
export function MicrosoftWallBanner({
  position,
  rotationY = 0,
  width = 6.4,
  height = 1.6,
}: {
  position: [number, number, number];
  rotationY?: number;
  width?: number;
  height?: number;
}) {
  const tex = useCanvasTexture(
    1536,
    384,
    (ctx) => {
      const w = 1536;
      const h = 384;

      // Microsoft Fluent dark acrylic glass background
      roundRect(ctx, 0, 0, w, h, 36);
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, 'rgba(15, 23, 42, 0.95)');
      bg.addColorStop(0.5, 'rgba(23, 37, 84, 0.92)');
      bg.addColorStop(1, 'rgba(49, 16, 75, 0.95)');
      ctx.fillStyle = bg;
      ctx.fill();

      // Top accent acrylic light rim
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.stroke();

      // Gradient accent highlight bar along the top
      const topBar = ctx.createLinearGradient(0, 0, w, 0);
      topBar.addColorStop(0, '#00A4EF'); // Microsoft blue
      topBar.addColorStop(0.35, '#774AE0'); // Copilot purple
      topBar.addColorStop(0.7, '#742774'); // Power Platform violet
      topBar.addColorStop(1, '#00C8F8'); // Fluent cyan
      ctx.fillStyle = topBar;
      roundRect(ctx, 16, 12, w - 32, 10, 5);
      ctx.fill();

      // Left Icon: Copilot Studio
      ctx.save();
      ctx.translate(60, 50);
      FLUENT_ICONS.copilot.draw(ctx, 120);
      ctx.restore();

      // Center-left branding text
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 52px ${SANS}`;
      ctx.fillText('Microsoft AI & Copilot Studio', 210, 60);

      ctx.fillStyle = '#60A5FA';
      ctx.font = `700 32px ${SANS}`;
      ctx.fillText('POWER PLATFORM INNOVATION LAB', 210, 120);

      // Subtitle badges / pill descriptions
      const pills = [
        { label: '⚡ Copilot Studio', bg: 'rgba(119, 74, 224, 0.35)', border: '#774AE0' },
        { label: '📊 Power BI & Apps', bg: 'rgba(116, 39, 116, 0.35)', border: '#A62AA6' },
        { label: '🔄 Power Automate', bg: 'rgba(0, 102, 255, 0.35)', border: '#0078D4' },
        { label: '☁️ Azure OpenAI', bg: 'rgba(0, 164, 239, 0.35)', border: '#00A4EF' },
      ];

      let pillX = 210;
      const pillY = 175;
      ctx.font = `600 24px ${SANS}`;

      pills.forEach((p) => {
        const pw = ctx.measureText(p.label).width + 36;
        roundRect(ctx, pillX, pillY, pw, 46, 23);
        ctx.fillStyle = p.bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.border;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(p.label, pillX + 18, pillY + 11);
        pillX += pw + 18;
      });

      // Mini row of Fluent icons on the right side of the banner
      const miniIcons: FluentIconName[] = ['powerapps', 'powerautomate', 'powerbi', 'teams', 'word', 'excel'];
      miniIcons.forEach((name, i) => {
        ctx.save();
        ctx.translate(w - 560 + i * 88, 250);
        FLUENT_ICONS[name].draw(ctx, 72);
        ctx.restore();
      });

      // Bottom footer text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.font = `500 22px ${SANS}`;
      ctx.fillText('Fluent UI Design System · Enterprise Autonomous Agent Ecosystem', 60, 275);
    },
    [],
  );

  return (
    <mesh position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}
