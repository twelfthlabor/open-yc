# Visa Navigator: Frontend Plan

Versions were checked on npm on 2026-10-09. Pin exact versions when scaffolding, and re-check the list before you start.

## 1. Stack

| Layer | Choice | Version (npm, 2026-10-09) | Why |
|---|---|---|---|
| Build | Vite | 8.3.4 | Fast dev server, simple config |
| UI | React | 19.3.0 | Matches `@react-three/fiber` v9 |
| Language | TypeScript | latest stable | Typed checklist and profile data |
| 3D | three | 0.186.1 | Rendering engine |
| 3D (React) | @react-three/fiber | 9.8.1 | React renderer for three (requires React 19) |
| 3D helpers | @react-three/drei | 10.7.9 | Ready-made cameras, controls, text, loaders |
| Scroll and timeline animation | gsap + @gsap/react | gsap 3.15.0 | Timelines, ScrollTrigger, `useGSAP` for cleanup |
| UI motion | motion | 14.1.0 | Component-level enter/exit and layout animation |

The `motion` package published a new version on the same day this was checked. Pin one version and don't upgrade during the build.

Version pairing that matters: `@react-three/fiber` v9 needs React 19. If you use React 18, use fiber v8 instead.

## 2. Where animation earns its place

Animation should explain a state change. It should not decorate. For this app:

| Screen | Motion | Tool |
|---|---|---|
| Checklist progress | Progress ring fills as items are confirmed | motion (layout + spring) |
| Step transitions in the application flow | Slide and fade between steps | motion (AnimatePresence) |
| Document intake | Scan line sweeps the passport image while extraction runs; fields pop in as they're confirmed | GSAP timeline |
| Long pages (guides, checklist with sections) | Pin the section heading while items scroll | GSAP ScrollTrigger |
| Trip view | A 3D globe with arcs from home to destination; arc draws in when the trip is set | R3F + drei + GSAP |
| Deadline tracker | Countdown ring; color shifts as an expiry approaches | motion or plain CSS |

Rule: if the animation doesn't tell the user something changed, remove it. Respect `prefers-reduced-motion`: disable GSAP timelines and 3D auto-rotation when the media query matches.

## 3. Three.js via React Three Fiber

Setup (after scaffolding with Vite and React 19):

```bash
npm install three@0.186.1 @react-three/fiber@9.8.1 @react-three/drei@10.7.9
```

Minimal pattern for the trip globe:

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';

export function TripGlobe() {
  return (
    <Canvas camera={{ position: [0, 0, 3] }} dpr={[1, 2]}>
      <ambientLight intensity={0.6} />
      <Sphere args={[1, 48, 48]}>
        <meshStandardMaterial color="#3a6ea5" />
      </Sphere>
      <OrbitControls enablePan={false} />
    </Canvas>
  );
}
```

Notes:
- Keep the scene small. The globe is decorative; the checklist must work with WebGL turned off. Render a static fallback when WebGL isn't available.
- Load textures and models once and reuse them. Dispose geometry when a view unmounts.
- Use `dpr={[1, 2]}` to cap pixel ratio on high-DPI screens.
- Drei has helpers for lines and arcs. For a route arc, build a `CatmullRomCurve3` between two points on the sphere and draw it with `Line` from drei.

## 4. GSAP with React

```bash
npm install gsap@3.15.0 @gsap/react
```

```tsx
import { useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function ChecklistSection({ title, children }: { title: string; children: React.ReactNode }) {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      gsap.from('.item', {
        opacity: 0,
        y: 12,
        stagger: 0.06,
        scrollTrigger: { trigger: scope.current, start: 'top 80%' },
      });
    },
    { scope }
  );

  return (
    <section ref={scope}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
```

Points to remember:
- Register plugins once, at module level, not inside components.
- `useGSAP` reverts animations on unmount. Animations created inside event handlers need `contextSafe` so they're cleaned up too.
- Scope selectors with the `scope` option so `.item` doesn't match elements elsewhere on the page.

## 5. Motion (UI)

Use motion for things that enter, exit, or re-layout in response to state: step transitions, list reordering, expanding cards. Use `AnimatePresence` for exit animations. Keep spring settings in one shared file so the app feels consistent.

## 6. Project layout

```
visa-navigator/
  docs/                  (design, research, plan; this folder)
  src/
    data/
      checklists/        one YAML per corridor, with sources and dates
    crypto/              passphrase key derivation and encryption
    mrz/                 ICAO 9303 check digits
    features/
      checklist/
      answers/
      intake/
      tracker/
      trip-globe/        R3F scene, lazy loaded
    motion/              shared GSAP and motion presets
    App.tsx
  server/                local Node server (Claude API calls, PDF export)
  .env                   ANTHROPIC key (gitignored)
```

Lazy-load the trip globe (`React.lazy`) so the three.js bundle doesn't slow down the checklist and forms.

## 7. Resources

Official docs:
- React Three Fiber: https://r3f.docs.pmnd.rs (install, first scene, LLM-readable index at `/llms.txt` and `/llms-full.txt`)
- Drei: https://drei.docs.pmnd.rs (index at `/llms.txt`)
- three.js: https://threejs.org/docs
- GSAP: https://gsap.com/docs/v3 (ScrollTrigger plugin under Plugins); React guide at https://gsap.com/react
- Motion: https://motion.dev (verify the React docs before use)

Recommended reading before building:
1. The R3F "your first scene" page, then the drei helpers you'll use.
2. GSAP's React guide (for `useGSAP`) and the ScrollTrigger basics.
3. The `prefers-reduced-motion` section of any accessibility guide, since it matters for every animation here.

Caution: some third-party skill pages claim to summarize GSAP's React usage. Check those claims against gsap.com before copying code.

## 8. Build order for the frontend

1. Scaffold Vite + React 19 + TypeScript; add a placeholder checklist page with no animation.
2. Build the checklist and answer-sheet flows with plain CSS. Make them work with JavaScript fully off except for the app shell.
3. Add motion to step transitions and the progress ring.
4. Add GSAP to document intake (scan line, field pop-in) and to long-page ScrollTrigger sections.
5. Add the R3F trip globe, lazy loaded, with a static fallback.
6. Check: keyboard navigation, screen reader labels on the 3D view (provide a text summary), reduced-motion behavior, and page weight with the globe loaded and not loaded.
