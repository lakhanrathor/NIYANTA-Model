import { useRef, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

const GRID = 128;

export default function Terrain() {
  const meshRef = useRef<THREE.Mesh>(null);

  const [heightmap, satellite] = useLoader(THREE.TextureLoader, [
    '/heightmap.png',
    '/satellite.png',
  ]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(100, 100, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useMemo(() => {
    heightmap.colorSpace = THREE.NoColorSpace;
    heightmap.minFilter = THREE.LinearFilter;
    heightmap.magFilter = THREE.LinearFilter;
    satellite.colorSpace = THREE.SRGBColorSpace;
  }, [heightmap, satellite]);

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={satellite}
        displacementMap={heightmap}
        displacementScale={0.35}
        displacementBias={-5}
        roughness={0.85}
        metalness={0.05}
      />
    </mesh>
  );
}
