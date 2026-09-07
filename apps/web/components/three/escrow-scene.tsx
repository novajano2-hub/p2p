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
import { useEffect, useMemo, useRef, type ReactNode } from "react";
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

/*
  The scene has to be told the theme. Glass takes its colour from the room, and
  the refraction buffer clears to an explicit colour because the canvas itself
  is transparent, so on a dark page a light palette renders a block that glows.
*/
type Palette = {
  /** What the glass refracts, and the buffer clear colour: the page behind it. */
  room: string;
  /** Studio panel brightness. Dark needs more, or the glass loses its edges. */
  env: number;
  glass: string;
  attenuation: string;
  coin: string;
  coinRim: string;
  edge: string;
  shadow: string;
  shadowOpacity: number;
  keyLight: number;
  fillLight: number;
  ambient: number;
};

const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    room: "#F6F4EE",
    env: 1,
    glass: "#F6F4EE",
    attenuation: "#ADB9A9",
    /* A shade above Forest so the coin still reads as green through the glass. */
    coin: "#2a6b55",
    coinRim: "#c9d3c6",
    edge: "#8fa394",
    shadow: "#202622",
    shadowOpacity: 0.3,
    keyLight: 1.2,
    fillLight: 0.6,
    ambient: 0.6,
  },
  /*
    Only the room goes dark. The glass, the coins and the rim are physical
    objects lit by a studio: darkening them too turns the vault into a black
    slab with nothing visible inside. Frosted glass in a dark room still
    catches the light, so it stays pale, just a shade below its light value so
    it does not glare against the page.
  */
  dark: {
    room: "#1b2420",
    env: 2.3,
    glass: "#dbe5dc",
    attenuation: "#93a89a",
    coin: "#2f8060",
    coinRim: "#cdd7ca",
    edge: "#8fa394",
    shadow: "#000000",
    shadowOpacity: 0.5,
    keyLight: 1.1,
    fillLight: 0.5,
    ambient: 0.5,
  },
};

/* The coin is a physical object: it looks the same in either room. */
const COIN_FACE_ETB = { background: "#ADB9A9", ink: "#1d3b31" } as const;
const COIN_FACE_USDT = { background: "#1f5346", ink: "#F1F4EE" } as const;

export type EscrowSceneProps = {
  /** prefers-reduced-motion: render one still frame, no loop. */
  reduced: boolean;
  /** Coarse pointer or few cores: lower sampling and resolution. */
  lowPower: boolean;
  /** Follows the resolved page theme. */
  dark: boolean;
};

export default function EscrowScene({ reduced, lowPower, dark }: EscrowSceneProps) {
  const palette = PALETTES[dark ? "dark" : "light"];
  return (
    <Canvas
      dpr={lowPower ? 1 : [1, 1.75]}
      camera={{ position: [0, 0.5, 9.6], fov: 30 }}
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
        <Vault reduced={reduced} lowPower={lowPower} palette={palette} />
        <UsdtCoin reduced={reduced} palette={palette} />
        <TradeCoin reduced={reduced} palette={palette} />
      </Rig>

      <ContactShadows
        position={[0, -1.8, 0]}
        opacity={palette.shadowOpacity}
        scale={9}
        blur={2.6}
        far={3.2}
        color={palette.shadow}
        frames={reduced ? 1 : Infinity}
      />

      <Studio palette={palette} />
      <hemisphereLight args={[palette.room, palette.attenuation, palette.fillLight]} />
      <ambientLight intensity={palette.ambient} />
      <directionalLight position={[3, 5, 4]} intensity={palette.keyLight} />
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

function Vault({
  reduced,
  lowPower,
  palette,
}: Omit<EscrowSceneProps, "dark"> & { palette: Palette }) {
  const mesh = useRef<THREE.Mesh>(null);
  // The refraction buffer clears to this. On a transparent canvas it would
  // otherwise clear to black and the glass would render dark.
  const refractionBackground = useMemo(() => new THREE.Color(palette.room), [palette.room]);

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
        color={palette.glass}
        attenuationColor={palette.attenuation}
        attenuationDistance={2.4}
      />
    </RoundedBox>
  );
}

/** The USDT, held. Sits at the centre of the vault. */
function UsdtCoin({ reduced, palette }: { reduced: boolean; palette: Palette }) {
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
          <meshStandardMaterial color={palette.coin} metalness={0.15} roughness={0.45} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.76, 0.035, 16, 120]} />
          <meshStandardMaterial color={palette.coinRim} metalness={0.4} roughness={0.35} />
        </mesh>
      </group>
    </Float>
  );
}

/*
  Orbit geometry.

  The vault turns, so its silhouette is widest across the diagonal:
  half-extent = 1.1 * sqrt(2) = 1.56, not 1.1. The coin's near edge must clear
  that at every point of the orbit, or it passes through the glass and the part
  inside is swallowed by the refraction buffer, which reads as the coin being
  cropped. So: ORBIT_X - COIN_RADIUS > 1.56, with room to spare.
*/
const VAULT_SILHOUETTE = 1.56;
const COIN_RADIUS = 0.36;
const COIN_THICKNESS = 0.09;
const ORBIT_X = VAULT_SILHOUETTE + COIN_RADIUS + 0.16; // 2.08
const ORBIT_Z = 2.4;

/**
 * A face of the coin, drawn on a 2D canvas rather than loaded as a font atlas,
 * so the scene still fetches nothing from a third-party CDN.
 */
function useCoinFace(text: string, background: string, ink: string) {
  const texture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = ink;
    ctx.font = `600 ${text.length > 3 ? 56 : 72}px "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, size / 2, size / 2 + 2);

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  }, [text, background, ink]);

  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

/** The trade itself, circling the vault: birr on one face, USDT on the other. */
function TradeCoin({ reduced, palette }: { reduced: boolean; palette: Palette }) {
  const group = useRef<THREE.Group>(null);
  const start = 1.1;
  const etb = useCoinFace("ETB", COIN_FACE_ETB.background, COIN_FACE_ETB.ink);
  const usdt = useCoinFace("USDT", COIN_FACE_USDT.background, COIN_FACE_USDT.ink);
  const faceOffset = COIN_THICKNESS / 2 + 0.002;

  useFrame((state) => {
    if (!group.current) return;
    const t = reduced ? start : start + state.clock.elapsedTime * 0.32;
    group.current.position.set(
      Math.cos(t) * ORBIT_X,
      Math.sin(t * 1.3) * 0.16 + 0.05,
      Math.sin(t) * ORBIT_Z,
    );
    // Turning with the orbit, so each face comes round in turn.
    group.current.rotation.y = -t;
  });

  return (
    <group ref={group} position={[Math.cos(start) * ORBIT_X, 0.05, Math.sin(start) * ORBIT_Z]}>
      {/* Milled edge. The cylinder axis is laid along Z so the faces look outward. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[COIN_RADIUS, COIN_RADIUS, COIN_THICKNESS, 64]} />
        <meshStandardMaterial color={palette.edge} metalness={0.35} roughness={0.4} />
      </mesh>
      {etb ? (
        <mesh position={[0, 0, faceOffset]}>
          <circleGeometry args={[COIN_RADIUS * 0.985, 64]} />
          <meshStandardMaterial map={etb} metalness={0.12} roughness={0.52} />
        </mesh>
      ) : null}
      {usdt ? (
        <mesh position={[0, 0, -faceOffset]} rotation={[0, Math.PI, 0]}>
          <circleGeometry args={[COIN_RADIUS * 0.985, 64]} />
          <meshStandardMaterial map={usdt} metalness={0.12} roughness={0.52} />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * A studio built from light panels instead of a downloaded HDRI, so the scene
 * never fetches anything from a third-party CDN. Rendered once.
 */
function Studio({ palette }: { palette: Palette }) {
  return (
    <Environment resolution={128} frames={1}>
      <Lightformer
        intensity={2.2 * palette.env}
        position={[0, 5, -5]}
        scale={[8, 3, 1]}
        form="rect"
      />
      <Lightformer
        intensity={1.4 * palette.env}
        position={[-5, 2, 3]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[3, 5, 1]}
        form="rect"
        color={palette.room}
      />
      <Lightformer
        intensity={0.9 * palette.env}
        position={[5, 0, 3]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[3, 3, 1]}
        form="circle"
        color={palette.attenuation}
      />
      <Lightformer
        intensity={0.6 * palette.env}
        position={[0, -4, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[8, 8, 1]}
        form="rect"
        color={palette.coinRim}
      />
    </Environment>
  );
}
