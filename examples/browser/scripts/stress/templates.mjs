/**
 * 10 substrate stress test templates.
 *
 * Each template returns { name, summary, files, package, expect } where:
 *   - name        — short ID used as test header
 *   - summary     — one-line description of what's being exercised
 *   - files       — { path: contents } map (relative to /work)
 *   - package     — additional package.json fields to merge into a base
 *                   { name, type:"module", scripts: {dev: "vite"} }
 *   - expect      — { rootContains?: string|RegExp, scriptCount?: number,
 *                     assertions?: (inspection) => string[] }
 *                   `rootContains` is a quick literal/regex check against
 *                   #root.textContent. `assertions` returns an array of
 *                   failure reasons (empty array = all pass).
 *
 * Templates are intentionally tiny: enough to exercise a specific
 * substrate code path (Tailwind pipeline, lazy routes, ?url imports,
 * etc.) without bloating npm install time. We test substrate behavior
 * not app correctness.
 */

const BASE_PKG = {
  name: "stress",
  private: true,
  version: "0.0.0",
  type: "module",
  scripts: { dev: "vite" },
};

// All stress templates ship the same vite.config base. Three substrate-
// specific knobs are baked in:
//
//   1. server.allowedHosts: true — the SW bridge forwards requests
//      without a real Host header, and Vite 5.4+ 403s those by default.
//
//   2. server.hmr: false — sidesteps the "ws://localhost:undefined"
//      pageerror. Vite's HMR WebSocket can't bind through the SW
//      bridge (which has no real socket), so we disable HMR entirely.
//      Without HMR, Vite also stops sending `full-reload` messages on
//      dep-optimizer version bumps — which is fine, since the iframe
//      couldn't receive them anyway.
//
//   3. optimizeDeps.noDiscovery + explicit include — Vite's dep
//      optimizer needs to run (it's how CJS modules like react's
//      jsx-dev-runtime get ESM-wrapped for the browser). But its
//      DISCOVERY phase, where it scans transformed source for new
//      bare imports, bumps the bundle version each time it finds
//      something — producing the 504 "Outdated Optimize Dep" race.
//      With noDiscovery: true the optimizer runs ONCE upfront over
//      the explicit `include` list and never re-bumps. Templates
//      that pull in extra deps (router, lucide, zustand) extend the
//      include list in their own vite.config.
// Default include list — every test gets these. Templates with extra
// bare deps (react-router-dom, lucide-react, zustand) extend it.
const BASE_INCLUDE = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"];
const viteConfig = (extraInclude = []) => `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: true, hmr: false },
  optimizeDeps: {
    noDiscovery: true,
    include: ${JSON.stringify([...BASE_INCLUDE, ...extraInclude])},
  },
});
`;
const VITE_CONFIG_BASIC = viteConfig();

const INDEX_HTML = (title) =>
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

const MAIN_TSX = `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

const REACT_DEPS = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "react-refresh": "^0.14.2",
  vite: "^5.4.8",
  "@vitejs/plugin-react": "^4.3.2",
};

// ─── T1: Vanilla baseline ────────────────────────────────────────────────
const T1 = {
  name: "T1-vanilla",
  summary: "Vanilla Vite + React TS, no extra deps — baseline regression guard",
  package: { ...BASE_PKG, dependencies: { ...REACT_DEPS } },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T1 vanilla"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `export function App() {
  return <h1 data-testid="root">T1 RENDERED</h1>;
}
`,
  },
  expect: {
    rootContains: "T1 RENDERED",
    assertions: (i) => (i.title === "T1 vanilla" ? [] : ["wrong title"]),
  },
};

// ─── T2: Tailwind 3 ──────────────────────────────────────────────────────
const T2 = {
  name: "T2-tailwind3",
  summary: "Vite + React + Tailwind 3 — postcss pipeline + utility classes",
  package: {
    ...BASE_PKG,
    dependencies: {
      ...REACT_DEPS,
      tailwindcss: "^3.4.0",
      postcss: "^8.4.0",
      autoprefixer: "^10.4.0",
    },
  },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T2 tailwind3"),
    "tailwind.config.js": `export default { content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"], theme: {}, plugins: [] };
`,
    "postcss.config.js": `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
    "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
`,
    "src/App.tsx": `export function App() {
  return <h1 className="text-3xl font-bold text-blue-600" data-testid="root">T2 TAILWIND</h1>;
}
`,
  },
  expect: {
    rootContains: "T2 TAILWIND",
    assertions: () => [],
  },
};

// ─── T3: CSS Modules ─────────────────────────────────────────────────────
const T3 = {
  name: "T3-cssmodules",
  summary: "CSS Modules — *.module.css with scoped class names",
  package: { ...BASE_PKG, dependencies: { ...REACT_DEPS } },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T3 css modules"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import styles from "./App.module.css";
export function App() {
  return <h1 className={styles.heading} data-testid="root">T3 CSSMOD</h1>;
}
`,
    "src/App.module.css": `.heading { color: rgb(50, 100, 200); font-size: 2rem; }
`,
  },
  expect: {
    rootContains: "T3 CSSMOD",
    assertions: () => [],
  },
};

// ─── T4: react-router-dom with lazy routes ───────────────────────────────
const T4 = {
  name: "T4-router-lazy",
  summary: "react-router-dom v6 + React.lazy — dynamic import + Suspense",
  package: {
    ...BASE_PKG,
    dependencies: { ...REACT_DEPS, "react-router-dom": "^6.27.0" },
  },
  files: {
    "vite.config.ts": viteConfig(["react-router-dom"]),
    "index.html": INDEX_HTML("T4 router lazy"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
const Home = lazy(() => import("./Home"));
export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<span>loading</span>}>
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
`,
    "src/Home.tsx": `export default function Home() {
  return <h1 data-testid="root">T4 LAZY ROUTE</h1>;
}
`,
  },
  expect: {
    rootContains: "T4 LAZY ROUTE",
    assertions: () => [],
  },
};

// ─── T5: ?url / ?raw asset imports ───────────────────────────────────────
const T5 = {
  name: "T5-asset-queries",
  summary: "Vite ?url and ?raw query-string asset imports",
  package: { ...BASE_PKG, dependencies: { ...REACT_DEPS } },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T5 asset queries"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import dataUrl from "./data.json?url";
import dataRaw from "./data.json?raw";
export function App() {
  const len = dataRaw.length;
  return <h1 data-testid="root">T5 ASSETS url={String(!!dataUrl)} raw-len={len}</h1>;
}
`,
    "src/data.json": JSON.stringify({ probe: "T5 ASSETS OK", n: 42 }, null, 2),
  },
  expect: {
    rootContains: /T5 ASSETS url=true raw-len=\d+/,
    assertions: () => [],
  },
};

// ─── T6: lucide-react icons ──────────────────────────────────────────────
const T6 = {
  name: "T6-lucide",
  summary: "lucide-react — large package with individual icon imports",
  package: {
    ...BASE_PKG,
    dependencies: { ...REACT_DEPS, "lucide-react": "^0.344.0" },
  },
  files: {
    "vite.config.ts": viteConfig(["lucide-react"]),
    "index.html": INDEX_HTML("T6 lucide"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import { Check, AlertTriangle } from "lucide-react";
export function App() {
  return (
    <h1 data-testid="root">
      T6 ICONS <Check size={16} /> + <AlertTriangle size={16} />
    </h1>
  );
}
`,
  },
  expect: {
    rootContains: /T6 ICONS/,
    assertions: () => [],
  },
};

// ─── T7: zustand state ───────────────────────────────────────────────────
const T7 = {
  name: "T7-zustand",
  summary: "zustand — module-level state + React hook integration",
  package: {
    ...BASE_PKG,
    dependencies: { ...REACT_DEPS, zustand: "^5.0.0" },
  },
  files: {
    "vite.config.ts": viteConfig(["zustand"]),
    "index.html": INDEX_HTML("T7 zustand"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import { create } from "zustand";
const useStore = create<{ n: number }>(() => ({ n: 7 }));
export function App() {
  const n = useStore((s) => s.n);
  return <h1 data-testid="root">T7 ZUSTAND n={n}</h1>;
}
`,
  },
  expect: {
    rootContains: /T7 ZUSTAND n=7/,
    assertions: () => [],
  },
};

// ─── T8: TypeScript path aliases ─────────────────────────────────────────
const T8 = {
  name: "T8-ts-aliases",
  summary: "TS path aliases — vite.config resolve.alias + tsconfig paths",
  package: {
    ...BASE_PKG,
    dependencies: { ...REACT_DEPS, typescript: "^5.4.0" },
  },
  files: {
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@components": resolve(here, "src/components") } },
  server: { allowedHosts: true },
});
`,
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          baseUrl: ".",
          paths: { "@components/*": ["./src/components/*"] },
          strict: true,
          isolatedModules: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2
    ),
    "index.html": INDEX_HTML("T8 ts aliases"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `import { Banner } from "@components/Banner";
export function App() {
  return <Banner label="T8 ALIASED" />;
}
`,
    "src/components/Banner.tsx": `export function Banner({ label }: { label: string }) {
  return <h1 data-testid="root">{label}</h1>;
}
`,
  },
  expect: {
    rootContains: "T8 ALIASED",
    assertions: () => [],
  },
};

// ─── T9: Tailwind + extended theme + plugin ──────────────────────────────
const T9 = {
  name: "T9-tailwind-extended",
  summary: "Tailwind 3 with extended theme (custom colors/font) + a tiny plugin",
  package: {
    ...BASE_PKG,
    dependencies: {
      ...REACT_DEPS,
      tailwindcss: "^3.4.0",
      postcss: "^8.4.0",
      autoprefixer: "^10.4.0",
    },
  },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T9 tailwind extended"),
    "tailwind.config.js": `import plugin from "tailwindcss/plugin";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { brand: { 500: "#19cc61" } },
      fontFamily: { display: ["Inter", "sans-serif"] },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({ ".text-probe": { color: "rgb(0, 200, 100)" } });
    }),
  ],
};
`,
    "postcss.config.js": `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
`,
    "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
`,
    "src/App.tsx": `export function App() {
  return (
    <h1 className="text-probe font-display text-brand-500" data-testid="root">
      T9 EXTENDED
    </h1>
  );
}
`,
  },
  expect: {
    rootContains: "T9 EXTENDED",
    assertions: () => [],
  },
};

// ─── T10: import.meta.glob + JSON modules ────────────────────────────────
const T10 = {
  name: "T10-glob-json",
  summary: "import.meta.glob over JSON files (eager) — Vite's glob primitive",
  package: { ...BASE_PKG, dependencies: { ...REACT_DEPS } },
  files: {
    "vite.config.ts": VITE_CONFIG_BASIC,
    "index.html": INDEX_HTML("T10 glob json"),
    "src/main.tsx": MAIN_TSX,
    "src/App.tsx": `const mods = import.meta.glob("./data/*.json", { eager: true }) as Record<string, { default: { id: string } }>;
export function App() {
  const ids = Object.values(mods).map((m) => m.default.id).join(",");
  return <h1 data-testid="root">T10 GLOB ids=[{ids}]</h1>;
}
`,
    "src/data/a.json": JSON.stringify({ id: "a" }),
    "src/data/b.json": JSON.stringify({ id: "b" }),
    "src/data/c.json": JSON.stringify({ id: "c" }),
  },
  expect: {
    rootContains: /T10 GLOB ids=\[(a,b,c|b,c,a|c,a,b|a,c,b|b,a,c|c,b,a)\]/,
    assertions: () => [],
  },
};

export const TESTS = [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10];
