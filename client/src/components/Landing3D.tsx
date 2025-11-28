import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float, Text3D, Center, Environment, Stars, Cloud } from '@react-three/drei';
import { useRef, useState, Suspense } from 'react';
import * as THREE from 'three';

// 3D Semi Truck Component
function SemiTruck({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      // Gentle swaying motion
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.02;
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Trailer */}
      <mesh position={[-1.5, 0.6, 0]}>
        <boxGeometry args={[4, 1.2, 1.2]} />
        <meshStandardMaterial color="#ffffff" metalness={0.3} roughness={0.4} />
      </mesh>

      {/* Trailer Red Stripe */}
      <mesh position={[-1.5, 0.8, 0.61]}>
        <boxGeometry args={[3.8, 0.3, 0.02]} />
        <meshStandardMaterial color="#dc2626" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Cab */}
      <mesh position={[1.2, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#dc2626" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Hood */}
      <mesh position={[1.9, 0.25, 0]}>
        <boxGeometry args={[0.5, 0.5, 0.9]} />
        <meshStandardMaterial color="#dc2626" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Windshield */}
      <mesh position={[1.35, 0.7, 0]}>
        <boxGeometry args={[0.05, 0.4, 0.8]} />
        <meshStandardMaterial color="#1e3a5f" metalness={0.9} roughness={0.1} transparent opacity={0.7} />
      </mesh>

      {/* Wheels */}
      {[[-3, -0.1, 0.5], [-3, -0.1, -0.5], [-2, -0.1, 0.5], [-2, -0.1, -0.5],
        [1.2, -0.1, 0.5], [1.2, -0.1, -0.5], [2, -0.1, 0.5], [2, -0.1, -0.5]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.25, 0.25, 0.15, 16]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.3} roughness={0.8} />
        </mesh>
      ))}

      {/* Exhaust stacks */}
      <mesh position={[0.7, 1.2, 0.4]}>
        <cylinderGeometry args={[0.05, 0.05, 0.5, 8]} />
        <meshStandardMaterial color="#666666" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}

// 3D Calendar Component
function Calendar3D({ position }: { position: [number, number, number] }) {
  const calendarRef = useRef<THREE.Group>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  useFrame((state) => {
    if (calendarRef.current) {
      // Gentle floating
      calendarRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.8) * 0.1;
      calendarRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.05;
    }
  });

  const days = Array.from({ length: 35 }, (_, i) => i);
  const driverAssignments = [1, 2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 26, 27, 28, 29, 30];

  return (
    <group ref={calendarRef} position={position}>
      {/* Calendar base/frame */}
      <mesh position={[0, 0, -0.1]}>
        <boxGeometry args={[5, 4, 0.15]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* Header bar */}
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[4.8, 0.5, 0.1]} />
        <meshStandardMaterial color="#3b82f6" metalness={0.4} roughness={0.4} />
      </mesh>

      {/* Day cells */}
      {days.map((day, i) => {
        const col = i % 7;
        const row = Math.floor(i / 7);
        const x = (col - 3) * 0.65;
        const y = 1 - row * 0.55;
        const hasAssignment = driverAssignments.includes(day);
        const isHovered = hoveredDay === day;

        return (
          <group key={i}>
            {/* Day cell background */}
            <mesh
              position={[x, y, isHovered ? 0.15 : 0.05]}
              onPointerOver={() => setHoveredDay(day)}
              onPointerOut={() => setHoveredDay(null)}
            >
              <boxGeometry args={[0.55, 0.45, 0.08]} />
              <meshStandardMaterial
                color={hasAssignment ? (isHovered ? "#22c55e" : "#16a34a") : (isHovered ? "#475569" : "#334155")}
                metalness={0.3}
                roughness={0.5}
                emissive={hasAssignment ? "#16a34a" : "#000000"}
                emissiveIntensity={isHovered ? 0.3 : 0.1}
              />
            </mesh>

            {/* Assignment indicator */}
            {hasAssignment && (
              <mesh position={[x, y - 0.1, 0.12]}>
                <boxGeometry args={[0.4, 0.15, 0.03]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.5} roughness={0.3} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// Animated Road
function Road() {
  const roadRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (roadRef.current) {
      // @ts-ignore - offset exists on material
      roadRef.current.material.map.offset.x = state.clock.elapsedTime * 0.1;
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <planeGeometry args={[30, 3]} />
      <meshStandardMaterial color="#374151" roughness={0.9} />
    </mesh>
  );
}

// Road lines
function RoadLines() {
  const linesRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (linesRef.current) {
      linesRef.current.position.x = -((state.clock.elapsedTime * 2) % 4) + 2;
    }
  });

  return (
    <group ref={linesRef}>
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[i * 4 - 10, -0.49, 0]}>
          <planeGeometry args={[2, 0.1]} />
          <meshStandardMaterial color="#fbbf24" />
        </mesh>
      ))}
    </group>
  );
}

// Floating stats/metrics
function FloatingStats() {
  const statsRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (statsRef.current) {
      statsRef.current.position.y = 2 + Math.sin(state.clock.elapsedTime * 0.6) * 0.15;
    }
  });

  return (
    <group ref={statsRef} position={[-4, 2, -2]}>
      {/* Stats panel */}
      <mesh>
        <boxGeometry args={[2, 1.5, 0.1]} />
        <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>

      {/* Stat bars */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.3, 0.3 - i * 0.4, 0.06]}>
          <boxGeometry args={[1.2 - i * 0.2, 0.15, 0.02]} />
          <meshStandardMaterial color={i === 0 ? "#22c55e" : i === 1 ? "#3b82f6" : "#f59e0b"} />
        </mesh>
      ))}
    </group>
  );
}

// Main Scene Component
function Scene() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[10, 10, 5]} intensity={1} castShadow />
      <pointLight position={[-5, 5, 5]} intensity={0.5} color="#3b82f6" />

      <Stars radius={100} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />

      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.5}>
        <SemiTruck position={[2, 0, 1]} />
      </Float>

      <Calendar3D position={[-3, 1, -1]} />

      <Road />
      <RoadLines />
      <FloatingStats />

      <Environment preset="night" />

      <OrbitControls
        enableZoom={false}
        enablePan={false}
        maxPolarAngle={Math.PI / 2}
        minPolarAngle={Math.PI / 4}
        autoRotate
        autoRotateSpeed={0.3}
      />
    </>
  );
}

// Loading component
function Loader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-white text-xl">Loading 3D Scene...</div>
    </div>
  );
}

// Main export
export default function Landing3D() {
  return (
    <div className="w-full h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      <Canvas
        camera={{ position: [0, 3, 10], fov: 50 }}
        shadows
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      {/* Overlay content */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="max-w-7xl mx-auto px-8 pt-32">
          <h1 className="text-6xl md:text-7xl font-bold text-white mb-6 drop-shadow-2xl">
            Meet <span className="text-blue-400">Milo</span>
          </h1>
          <p className="text-xl md:text-2xl text-slate-300 max-w-2xl mb-8 drop-shadow-lg">
            AI-Powered Trucking Operations. Intelligent scheduling, DOT compliance,
            and fleet management—all in one evolving platform.
          </p>
          <div className="flex gap-4 pointer-events-auto">
            <a
              href="/login"
              className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all transform hover:scale-105 shadow-lg"
            >
              Get Started
            </a>
            <a
              href="#features"
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-lg backdrop-blur-sm transition-all border border-white/20"
            >
              Learn More
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
