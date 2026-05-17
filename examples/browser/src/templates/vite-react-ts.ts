/**
 * Bundled `vite-react-ts` template.
 *
 * Mirrors what `create-vite@latest --template react-ts` would produce, with
 * two sandbox-specific tweaks:
 *
 *   1. ALL deps go in `dependencies`, not `devDependencies` — almostnode's
 *      `npm install` skips devDeps (piebox#2). Putting everything in
 *      dependencies means `npm install` alone gets the project runnable.
 *
 *   2. Skipped: eslint config, public/vite.svg, src/assets/react.svg. Those
 *      add weight without contributing to a runnable app in the sandbox.
 *
 * The intent is "what an LLM-driven sandbox needs to scaffold + dev-serve a
 * Vite React TS app," not "verbatim reproduce upstream's template."
 */

export const viteReactTsTemplate: Record<string, string> = {
  "package.json": JSON.stringify(
    {
      name: "vite-react-ts",
      private: true,
      version: "0.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
      // EVERYTHING in dependencies — see header comment.
      // react-refresh is listed explicitly: @vitejs/plugin-react peer-depends
      // on it for Fast Refresh, and almostnode's npm install doesn't pull
      // optional/peer deps. Without it the plugin throws
      // "Failed to resolve module specifier 'react-refresh/babel'" the first
      // time it tries to transform /src/main.tsx and the React app never
      // mounts.
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        "react-refresh": "^0.14.2",
        vite: "^5.4.8",
        "@vitejs/plugin-react": "^4.3.2",
        typescript: "^5.6.2",
        "@types/react": "^18.3.10",
        "@types/react-dom": "^18.3.0",
      },
    },
    null,
    2,
  ) + "\n",

  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React + TS</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The piebox playground reaches the dev server through almostnode's
    // Service Worker bridge (http://<host>/__virtual__/<port>/). The
    // bridge forwards requests without a normal Host header, so Vite's
    // 5.4+ allowedHosts check 403s by default. Allow all hosts — the
    // bridge is the only thing on the wire.
    allowedHosts: true,
    // Don't pass --host on the CLI; binding to localhost is fine here
    // because the bridge handles cross-origin exposure for us.
  },
});
`,

  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        useDefineForClassFields: true,
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
        strict: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        noFallthroughCasesInSwitch: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n",

  "src/vite-env.d.ts": `/// <reference types="vite/client" />
`,

  "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,

  "src/App.tsx": `import { useState } from "react";
import "./App.css";

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="app">
      <h1>Vite + React + TS</h1>
      <div className="card">
        <button onClick={() => setCount((c) => c + 1)}>count is {count}</button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR.
        </p>
      </div>
      <p className="read-the-docs">scaffolded by piebox's bundled template</p>
    </div>
  );
}

export default App;
`,

  "src/App.css": `.app {
  max-width: 1280px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}
.card { padding: 2em; }
button {
  border-radius: 8px;
  border: 1px solid transparent;
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: #1a1a1a;
  color: white;
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover { border-color: #646cff; }
.read-the-docs { color: #888; }
`,

  "src/index.css": `:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  color: rgba(255, 255, 255, 0.87);
  background-color: #242424;
}
body {
  margin: 0;
  display: flex;
  place-items: center;
  min-width: 320px;
  min-height: 100vh;
}
#root {
  width: 100%;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  background: rgba(255, 255, 255, 0.1);
  padding: 0.1em 0.3em;
  border-radius: 4px;
}
`,
};

/**
 * Registry of bundled templates. The key matches the value the agent passes
 * after `--template` (matching create-vite's convention).
 */
export const BUNDLED_TEMPLATES: Record<string, Record<string, string>> = {
  "react-ts": viteReactTsTemplate,
};
