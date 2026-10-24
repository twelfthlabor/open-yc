import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { countryByCode } from '../data/countries';
import { LAND_DOTS, latLonToXYZ } from './land';

const DEG = Math.PI / 180;
const R = 1;
const FOV = 40;
const DOT_SIZE = 0.024; // world units; scaled to screen pixels every frame

/** sRGB hex as a vec3 for shaders. ShaderMaterial writes its output unchanged, so these stay the exact colours. */
function rgb(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const BODY_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

// Deep ocean colour, brightened toward the limb so the sphere reads as lit glass.
const BODY_FRAG = /* glsl */ `
  uniform vec3 uOcean;
  uniform vec3 uRim;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    float rim = pow(1.0 - clamp(dot(n, normalize(vView)), 0.0, 1.0), 2.4);
    float sheen = pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 6.0);
    gl_FragColor = vec4(mix(uOcean, uRim, rim * 0.85) + uRim * sheen * 0.14, 1.0);
  }`;

const GLOW_VERT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Back-face shell, added on top: strongest at the edge of the disc, fading out into space.
const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
    // Alpha carries the glow, so the fade reaches the page instead of painting dark pixels.
    gl_FragColor = vec4(uColor, intensity);
  }`;

// Round points. gl_PointSize is set from a world size, so dots keep their proportion as the view resizes.
const DOT_VERT = /* glsl */ `
  uniform float uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;

const DOT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    if (d > 0.5) discard;
    gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(0.15, 0.5, d)));
  }`;

function toVector(lat: number, lon: number, r = R): THREE.Vector3 {
  const [x, y, z] = latLonToXYZ(lat, lon);
  return new THREE.Vector3(x, y, z).multiplyScalar(r);
}

/** An arc over the globe from a to b, lifted further the longer the flight. */
function arcCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 | undefined {
  const angle = a.angleTo(b);
  if (angle < 1e-6) return undefined;
  const lift = 0.18 + angle * 0.3;
  const s = Math.sin(angle);
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const p = a
      .clone()
      .multiplyScalar(Math.sin((1 - t) * angle) / s)
      .add(b.clone().multiplyScalar(Math.sin(t * angle) / s));
    points.push(p.multiplyScalar(R + Math.sin(Math.PI * t) * lift));
  }
  return new THREE.CatmullRomCurve3(points);
}

/** Random points behind the globe, so none sit between the camera and the disc. */
function starField(count = 650): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 12;
    const s = Math.sqrt(1 - u * u);
    out.set([r * s * Math.cos(phi), r * u, -Math.abs(r * s * Math.sin(phi)) - 1], i * 3);
  }
  return out;
}

function Arc({ curve, reduced }: { curve: THREE.CatmullRomCurve3; reduced: boolean }) {
  const geometry = useMemo(() => new THREE.TubeGeometry(curve, 160, 0.008, 10, false), [curve]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const total = geometry.index?.count ?? 0;
  const progress = useRef(reduced ? 1 : 0);
  const head = useRef<THREE.Mesh>(null);

  useFrame(({ clock }, dt) => {
    if (progress.current < 1) {
      progress.current = Math.min(1, progress.current + dt / 1.8);
    }
    const eased = 1 - Math.pow(1 - progress.current, 3);
    geometry.setDrawRange(0, Math.floor(eased * total));
    if (!head.current) return;
    if (progress.current < 1) {
      head.current.visible = true;
      head.current.position.copy(curve.getPointAt(eased));
    } else if (reduced) {
      head.current.visible = false;
    } else {
      // Once drawn, a short spark travels the route on a loop.
      head.current.visible = true;
      head.current.position.copy(curve.getPointAt((clock.elapsedTime * 0.22) % 1));
    }
  });

  return (
    <group>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.9} />
      </mesh>
      <mesh ref={head}>
        <sphereGeometry args={[0.024, 12, 12]} />
        <meshBasicMaterial color="#e0faff" />
      </mesh>
    </group>
  );
}

/** A marker on the surface with a ring that pulses outward. The ring stays still under reduced motion. */
function Pin({ at, color, delay = 0, reduced }: { at: THREE.Vector3; color: string; delay?: number; reduced: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const normal = useMemo(() => at.clone().normalize(), [at]);
  const orientation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal), [normal]);
  const lifted = useMemo(() => normal.clone().multiplyScalar(R + 0.012), [normal]);

  useFrame(({ clock }) => {
    if (reduced || !ring.current) return;
    const phase = ((clock.elapsedTime + delay) % 2.4) / 2.4;
    ring.current.scale.setScalar(1 + phase * 3.2);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.85;
  });

  return (
    <group position={lifted} quaternion={orientation}>
      <mesh>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.03, 0.038, 48]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

function Scene({ from, to, reduced, active }: { from?: string; to?: string; reduced: boolean; active: boolean }) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  // With reduced motion the loop only renders on request, so draw one frame when the globe comes back on screen.
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  const a = from ? countryByCode(from) : undefined;
  const b = to ? countryByCode(to) : undefined;
  const pa = useMemo(() => (a ? toVector(a.lat, a.lon) : undefined), [a]);
  const pb = useMemo(() => (b ? toVector(b.lat, b.lon) : undefined), [b]);
  const arc = useMemo(() => (pa && pb ? arcCurve(pa, pb) : undefined), [pa, pb]);
  const stars = useMemo(() => starField(), []);

  // Turn the globe so the middle of the route faces the camera.
  const base = useMemo(() => {
    if (!pa || !pb) return { x: 0.35, y: 0 };
    const mid = pa.clone().add(pb).normalize();
    const lat = 90 - Math.acos(mid.y) / DEG;
    const theta = Math.atan2(mid.z, -mid.x);
    return { x: lat * DEG, y: Math.PI / 2 - theta };
  }, [pa, pb]);

  const dotMaterial = useRef<THREE.ShaderMaterial>(null);
  const starMaterial = useRef<THREE.ShaderMaterial>(null);
  const bodyUniforms = useMemo(() => ({ uOcean: { value: rgb('#071230') }, uRim: { value: rgb('#3f7bff') } }), []);
  const glowUniforms = useMemo(() => ({ uColor: { value: rgb('#4f8dff') } }), []);
  const dotUniforms = useMemo(() => ({ uSize: { value: 1 }, uColor: { value: rgb('#8ec5ff') }, uOpacity: { value: 0.95 } }), []);
  const starUniforms = useMemo(() => ({ uSize: { value: 1 }, uColor: { value: rgb('#cfe3ff') }, uOpacity: { value: 0.5 } }), []);

  useFrame(({ clock, size, viewport }) => {
    // Converts the world dot size into device pixels for the current view. Set on each material's own uniforms.
    const px = (DOT_SIZE * size.height * viewport.dpr) / (2 * Math.tan((FOV / 2) * DEG));
    if (dotMaterial.current) dotMaterial.current.uniforms.uSize.value = px;
    if (starMaterial.current) starMaterial.current.uniforms.uSize.value = px;
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.rotation.x = base.x;
    group.current.rotation.y = reduced ? base.y : base.y + (pa && pb ? Math.sin(t * 0.3) * 0.12 : t * 0.08);
  });

  return (
    <>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[stars, 3]} />
        </bufferGeometry>
        <shaderMaterial ref={starMaterial} vertexShader={DOT_VERT} fragmentShader={DOT_FRAG} uniforms={starUniforms} transparent depthWrite={false} />
      </points>
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[R, 96, 96]} />
          <shaderMaterial vertexShader={BODY_VERT} fragmentShader={BODY_FRAG} uniforms={bodyUniforms} />
        </mesh>
        {/* Lifted just off the surface so the dots are not cut in half by the sphere. */}
        <points scale={1.012}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[LAND_DOTS, 3]} />
          </bufferGeometry>
          <shaderMaterial ref={dotMaterial} vertexShader={DOT_VERT} fragmentShader={DOT_FRAG} uniforms={dotUniforms} transparent depthWrite={false} />
        </points>
        {pa && <Pin at={pa} color="#ffffff" reduced={reduced} />}
        {pb && <Pin at={pb} color="#34d399" delay={1.2} reduced={reduced} />}
        {arc && <Arc curve={arc} reduced={reduced} />}
      </group>
      <mesh>
        <sphereGeometry args={[R * 1.2, 64, 64]} />
        <shaderMaterial
          vertexShader={GLOW_VERT}
          fragmentShader={GLOW_FRAG}
          uniforms={glowUniforms}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          transparent
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

/** `active` is false while the globe is off screen: the render loop stops until it comes back. */
export default function TripGlobe({ from, to, reduced = false, active = true }: { from?: string; to?: string; reduced?: boolean; active?: boolean }) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.55], fov: FOV }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      frameloop={!active ? 'never' : reduced ? 'demand' : 'always'}
      aria-hidden="true"
    >
      <Scene from={from} to={to} reduced={reduced} active={active} />
    </Canvas>
  );
}
