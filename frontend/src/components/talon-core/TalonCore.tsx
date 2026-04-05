"use client";

/**
 * TalonCore.tsx — TALON Phase 28
 * Rotating 3000-point particle sphere with a pulsing glow halo.
 * Built with @react-three/fiber + @react-three/drei.
 */

import { Points, PointMaterial, Sphere } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useMemo } from "react";
import * as THREE from "three";

// ── Particle sphere geometry ───────────────────────────────────────────────
function ParticleSphere() {
  const ref = useRef<THREE.Points>(null!);

  // Generate 3000 points uniformly distributed on a sphere surface
  const positions = useMemo(() => {
    const count = 3000;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Marsaglia's method for uniform sphere distribution
      let x: number, y: number, z: number, d: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        d = x * x + y * y + z * z;
      } while (d > 1 || d === 0);
      const scale = 1.5 / Math.sqrt(d);
      arr[i * 3]     = x * scale;
      arr[i * 3 + 1] = y * scale;
      arr[i * 3 + 2] = z * scale;
    }
    return arr;
  }, []);

  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.08;
    ref.current.rotation.x += delta * 0.02;
  });

  return (
    <Points ref={ref} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <PointMaterial
        color="#38bdf8"
        size={0.012}
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.85}
      />
    </Points>
  );
}

// ── Pulsing glow halo ────────────────────────────────────────────────────
function GlowOrb() {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    // Sine wave between 0.04 and 0.14 opacity — slow breathe
    const t = clock.getElapsedTime();
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
      0.04 + 0.1 * Math.abs(Math.sin(t * 0.6));
  });

  return (
    <Sphere ref={meshRef} args={[1.65, 64, 64]}>
      <meshBasicMaterial
        color="#818cf8"
        transparent
        opacity={0.08}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </Sphere>
  );
}

// ── Inner accent ring ───────────────────────────────────────────────────
function InnerGlow() {
  const meshRef = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
      0.03 + 0.06 * Math.abs(Math.sin(t * 1.1 + 1));
  });

  return (
    <Sphere ref={meshRef} args={[1.55, 48, 48]}>
      <meshBasicMaterial
        color="#38bdf8"
        transparent
        opacity={0.05}
        side={THREE.FrontSide}
        depthWrite={false}
      />
    </Sphere>
  );
}

// ── Scene ─────────────────────────────────────────────────────────────────
function Scene() {
  return (
    <>
      <ambientLight intensity={0.1} />
      <pointLight position={[0, 0, 3]} intensity={1.5} color="#818cf8" />
      <pointLight position={[0, 0, -3]} intensity={0.8} color="#38bdf8" />
      <ParticleSphere />
      <InnerGlow />
      <GlowOrb />
    </>
  );
}

// ── Public component ──────────────────────────────────────────────────────
interface TalonCoreProps {
  /** Canvas width/height (CSS). Defaults to 100% of parent. */
  className?: string;
  style?: React.CSSProperties;
}

export default function TalonCore({ className, style }: TalonCoreProps) {
  return (
    <div
      className={className}
      style={{ background: "#050a14", borderRadius: "50%", overflow: "hidden", ...style }}
    >
      <Canvas
        camera={{ position: [0, 0, 4], fov: 55 }}
        gl={{ antialias: true, alpha: false }}
        style={{ width: "100%", height: "100%" }}
      >
        <Scene />
      </Canvas>
    </div>
  );
}
