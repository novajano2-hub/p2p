"use client";

import {
  ContactShadows,
  Environment,
  Float,
  Lightformer,
  MeshTransmissionMaterial,
  RoundedBox,
} from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";

/*
  The escrow vault.

  A frosted glass block holds a forest-green USDT coin. A sage birr coin
  circles it, outside, waiting. That is the product in one object: the USDT
  is visibly held, and nothing about the birr can touch it.

  Purpose of the motion: explanation. The block turns slowly so the glass
  reads as glass, the coins drift so the scene reads as alive, and the whole
  group leans toward the pointer so it reads as present. Under reduced motion
  every one of those stops and a single still frame is rendered.
*/

const SAGE = "#ADB9A9";
const CANVAS = "#F6F4EE";
const INK = "#202622";
/* A shade above Forest so the coin still reads as green through frosted glass. */
const COIN = "#2a6b55";
const COIN_RIM = "#c9d3c6";
const BIRR = "#8fa394";

export type EscrowSceneProps = {
  /** prefers-reduced-motion: render one still frame, no loop. */
  reduced: boolean;
  /** Coarse pointer or few cores: lower sampling and resolution. */
  lowPower: boolean;
};

export default function EscrowScene({ reduced, lowPower }: EscrowSceneProps) {
  return (
    <Canvas
      dpr={lowPower ? 1 : [1, 1.75]}
      camera={{ position: [0, 0.6, 7.4], fov: 30 }}
      frameloop={reduced ? "demand" : "always"}
      // No tone mapping: the kit's exact colours, and a background identical to the page.
      flat
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: lowPower ? "low-power" : "high-performance",
      }}
      style={{ background: "transparent" }}
    >
      <Rig reduced={reduced}>
        <Vault reduced={reduced} lowPower={lowPower} />
        <UsdtCoin reduced={reduced} />
        <BirrCoin reduced={reduced} />
      </Rig>

      <ContactShadows
        position={[0, -1.8, 0]}
        opacity={0.3}
        scale={9}
        blur={2.6}
        far={3.2}
        color={INK}
        frames={reduced ? 1 : Infinity}
      />

      <Studio />
      <hemisphereLight args={[CANVAS, SAGE, 0.6]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 4]} intensity={1.2} />
    </Canvas>
  );
}

/** Leans the whole scene toward the pointer, damped so it never snaps. */
function Rig({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (reduced || !group.current) return;
    const { x, y } = state.pointer;
    group.current.rotation.y = THREE.MathUtils.damp(group.current.rotation.y, x * 0.22, 3, delta);
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, -y * 0.12, 3, delta);
  });

  return <group ref={group}>{children}</group>;
}

function Vault({ reduced, lowPower }: EscrowSceneProps) {
  const mesh = useRef<THREE.Mesh>(null);
  // The refraction buffer clears to this. On a transparent canvas it would
  // otherwise clear to black and the glass would render dark.
  const refractionBackground = useMemo(() => new THREE.Color(CANVAS), []);

  useFrame((state, delta) => {
    if (reduced || !mesh.current) return;
    mesh.current.rotation.y += delta * 0.16;
    mesh.current.rotation.x = 0.22 + Math.sin(state.clock.elapsedTime * 0.35) * 0.06;
  });

  return (
    <RoundedBox
      ref={mesh}
      args={[2.2, 2.2, 2.2]}
      radius={0.2}
      smoothness={6}
      rotation={[0.22, 0.65, 0]}
    >
      <MeshTransmissionMaterial
        background={refractionBackground}
        samples={lowPower ? 6 : 10}
        resolution={lowPower ? 256 : 512}
        thickness={1.1}
        roughness={0.2}
        transmission={1}
        ior={1.36}
        chromaticAberration={0}
        anisotropy={0.08}
        color={CANVAS}
        attenuationColor={SAGE}
        attenuationDistance={2.4}
      />
    </RoundedBox>
  );
}

/** The USDT, held. Sits at the centre of the vault. */
function UsdtCoin({ reduced }: { reduced: boolean }) {
  return (
    <Float
      speed={reduced ? 0 : 1.3}
      rotationIntensity={reduced ? 0 : 0.3}
      floatIntensity={reduced ? 0 : 0.45}
    >
      {/* Face-on, so it reads as one solid disc with a pale milled rim. */}
      <group rotation={[Math.PI / 2 - 0.22, 0.12, 0]}>
        <mesh>
          <cylinderGeometry args={[0.76, 0.76, 0.16, 80]} />
          <meshStandardMaterial color={COIN} metalness={0.15} roughness={0.45} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.76, 0.035, 16, 120]} />
          <meshStandardMaterial color={COIN_RIM} metalness={0.4} roughness={0.35} />
        </mesh>
      </group>
    </Float>
  );
}

/** The birr, outside the vault, circling. */
function BirrCoin({ reduced }: { reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const start = 1.1;

  useFrame((state) => {
    if (!group.current) return;
    const t = reduced ? start : start + state.clock.elapsedTime * 0.32;
    // An orbit deeper than it is wide: the coin passes in front of and behind
    // the vault instead of swinging out past the edges of the canvas.
    group.current.position.set(
      Math.cos(t) * 1.45,
      Math.sin(t * 1.3) * 0.2 + 0.05,
      Math.sin(t) * 2.35,
    );
    group.current.rotation.y = -t;
  });

  return (
    <group ref={group} position={[Math.cos(start) * 1.45, 0.05, Math.sin(start) * 2.35]}>
      <mesh rotation={[Math.PI / 2 - 0.5, 0, 0.3]}>
        <cylinderGeometry args={[0.42, 0.42, 0.1, 64]} />
        <meshStandardMaterial color={BIRR} metalness={0.3} roughness={0.45} />
      </mesh>
    </group>
  );
}

/**
 * A studio built from light panels instead of a downloaded HDRI, so the scene
 * never fetches anything from a third-party CDN. Rendered once.
 */
function Studio() {
  return (
    <Environment resolution={128} frames={1}>
      <Lightformer intensity={2.2} position={[0, 5, -5]} scale={[8, 3, 1]} form="rect" />
      <Lightformer
        intensity={1.4}
        position={[-5, 2, 3]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[3, 5, 1]}
        form="rect"
        color={CANVAS}
      />
      <Lightformer
        intensity={0.9}
        position={[5, 0, 3]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[3, 3, 1]}
        form="circle"
        color={SAGE}
      />
      <Lightformer
        intensity={0.6}
        position={[0, -4, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[8, 8, 1]}
        form="rect"
        color="#DADFD6"
      />
    </Environment>
  );
}
