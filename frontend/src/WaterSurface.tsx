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
  terrain?: { grid_size: number; height_scale: number };
}

const GRID = 128;
const WORLD_SIZE = 100;

const waterVertexShader = `
  uniform sampler2D uHeightMap;
  uniform float uTime;
  uniform float uWaterLevel;
  varying vec2 vUv;
  varying float vElevation;
  varying float vDistToCenter;

  void main() {
    vUv = uv;
    vec3 pos = position;

    float h = texture2D(uHeightMap, uv).r;
    vElevation = h;

    float dist = length(pos.xz) / 50.0;
    vDistToCenter = dist;

    pos.y = uWaterLevel + sin(uTime * 1.5 + pos.x * 0.3) * 0.05;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uFoamColor;
  varying vec2 vUv;
  varying float vElevation;
  varying float vDistToCenter;

  void main() {
    float depth = clamp(vElevation * 0.1, 0.0, 1.0);
    vec3 baseColor = mix(uShallowColor, uDeepColor, depth);

    float edge = smoothstep(0.0, 0.15, vDistToCenter);
    float foam = (1.0 - edge) * 0.3;
    foam += sin(vUv.x * 40.0 + uTime * 2.0) * sin(vUv.y * 40.0 + uTime * 1.5) * 0.05;

    vec3 color = mix(uFoamColor, baseColor, clamp(1.0 - foam, 0.0, 1.0));

    float fresnel = pow(1.0 - abs(dot(normalize(vec3(vUv.x - 0.5, 0.0, vUv.y - 0.5)), vec3(0.0, 1.0, 0.0))), 2.0);
    color += vec3(0.15, 0.25, 0.35) * fresnel * 0.3;

    gl_FragColor = vec4(color, uOpacity);
  }
`;

interface WaterSurfaceProps {
  data: SimulationData;
  currentFrame: number;
}

export default function WaterSurface({ data, currentFrame }: WaterSurfaceProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const heightmap = useMemo(() => {
    const tex = new THREE.TextureLoader().load('/heightmap.png');
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, []);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, GRID - 1, GRID - 1);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  const uniforms = useMemo(() => ({
    uHeightMap: { value: heightmap },
    uTime: { value: 0 },
    uWaterLevel: { value: 0 },
    uOpacity: { value: 0.7 },
    uDeepColor: { value: new THREE.Color(0x0a2a5e) },
    uShallowColor: { value: new THREE.Color(0x1a6faa) },
    uFoamColor: { value: new THREE.Color(0xd0e8ff) },
  }), [heightmap]);

  useFrame((state) => {
    if (!matRef.current) return;
    matRef.current.uniforms.uTime.value = state.clock.elapsedTime;

    // Compute water level from current frame's water particles
    const frame = data.frames[currentFrame];
    if (!frame) return;

    let maxY = 0;
    let count = 0;
    for (const p of frame.particles) {
      if (p[3] === 1) { // water
        maxY = Math.max(maxY, p[1]);
        count++;
      }
    }
    // Smooth water level rise
    const target = count > 0 ? maxY * 0.06 : 0;
    const current = matRef.current.uniforms.uWaterLevel.value;
    matRef.current.uniforms.uWaterLevel.value += (target - current) * 0.1;
  });

  return (
    <mesh ref={meshRef} geometry={geometry} position={[50, 0, 50]} renderOrder={1}>
      <shaderMaterial
        ref={matRef}
        vertexShader={waterVertexShader}
        fragmentShader={waterFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
