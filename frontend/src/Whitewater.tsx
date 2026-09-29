import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

type Particle = [number, number, number, number, number, number, number];

interface FrameData {
  frame_id: number;
  particles: Particle[];
}

interface SimulationData {
  frames: FrameData[];
}

const MAX_INSTANCES = 3000;
const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();

// Velocity → color: slow=transparent, medium=light blue, fast=white
function velocityToColor(vx: number, vy: number, vz: number): THREE.Color {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (speed < 0.3) return new THREE.Color(0, 0, 0); // invisible
  const t = Math.min(speed / 5.0, 1.0);
  // Deep blue → cyan → white
  return new THREE.Color().setHSL(
    0.55 - t * 0.08,
    1.0 - t * 0.7,
    0.3 + t * 0.7
  );
}

interface WhitewaterProps {
  data: SimulationData;
  currentFrame: number;
}

export default function Whitewater({ data, currentFrame }: WhitewaterProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => new THREE.SphereGeometry(0.3, 4, 4), []);

  useFrame(() => {
    if (!meshRef.current) return;
    const frame = data.frames[currentFrame];
    if (!frame) return;

    let idx = 0;
    for (const p of frame.particles) {
      if (idx >= MAX_INSTANCES) break;
      if (p[3] !== 1) continue; // water only

      const vx = p[4] || 0;
      const vy = p[5] || 0;
      const vz = p[6] || 0;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

      if (speed < 0.8) continue; // only render fast particles

      dummy.position.set(p[0], p[1] + 0.3, p[2]);
      const scale = Math.min(speed / 3.0, 1.5) * 0.8;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(idx, dummy.matrix);

      tempColor.copy(velocityToColor(vx, vy, vz));
      meshRef.current.setColorAt(idx, tempColor);

      idx++;
    }

    // Hide remaining instances
    for (let i = idx; i < MAX_INSTANCES; i++) {
      dummy.position.set(0, -1000, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
    meshRef.current.count = idx;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, MAX_INSTANCES]}
      frustumCulled={false}
      renderOrder={2}
    >
      <meshStandardMaterial
        transparent
        opacity={0.8}
        roughness={0.2}
        metalness={0.1}
        emissive={0xffffff}
        emissiveIntensity={0.3}
      />
    </instancedMesh>
  );
}
