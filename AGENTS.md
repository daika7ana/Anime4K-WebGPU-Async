# AGENTS.md

TypeScript library (**`anime4k-webgpu-async`**) implementing real-time Anime4K upscaling,
denoising and deblurring as WebGPU compute pipelines. v3 is **ESM-only** (`"type": "module"`):
it ships a per-module ESM graph at `dist/**` plus type declarations — no UMD, no CJS, no CDN
global. There is **no test suite and no CI** — verify with build + `verify` (and the browser demo
for rendering changes; there is no headless GPU path).

## Commands

```bash
pnpm install                      # pnpm 11 (packageManager); pnpm-lock.yaml, no package-lock.json
pnpm run build                    # vite build (Vite 8 + Rolldown, config: vite.config.ts)
pnpm run verify                   # build + check:preset-parity + check:packaging + lint + format:check
pnpm run dev                      # nodemon: rebuild on src/**/*.{ts,js,wgsl} change
pnpm run lint                     # eslint . (flat config: eslint.config.mjs)
pnpm run format                   # prettier --write . (Prettier owns formatting)
pnpm run format:check             # prettier --check . (also runs inside verify)
pnpm exec tsc --noEmit            # type-check src/ under TypeScript 6
pnpm run check:preset-parity      # preset-parity check
pnpm run check:packaging          # package `exports` / field checks
```

- Package manager is **pnpm 11** (`packageManager`; `pnpm-lock.yaml` is the only lockfile).
  The old `package-lock.json` was removed and is gitignored — **do not run `npm` commands in
  this repo**. pnpm settings (e.g. `allowBuilds` for the `unrs-resolver` postinstall) live in
  `pnpm-workspace.yaml`.
- `build` = `vite build` (Vite 8, whose default bundler is Rolldown with Oxc; config
  `vite.config.ts`). The library build uses `build.rolldownOptions.output.preserveModules`
  (`preserveModulesRoot: 'src'`) to emit a per-module ESM graph into `dist/**` (root entry
  `dist/index.js`), and `build.rolldownOptions.moduleTypes` to treat `.wgsl` as text. There is
  deliberately **no nested `dist/package.json`** (that would break `sideEffects` resolution).
  Declarations come from `unplugin-dts/vite` (`entryRoot: 'src'`, `outDirs: 'dist'`) with a
  `beforeWriteFile` hook that adds explicit `.js` extensions to emitted `.d.ts` specifiers and
  prepends `/// <reference types="@webgpu/types" />` to the four public entry declarations
  (`dist/index.d.ts`, `dist/engines/index.d.ts`, `dist/engines/anime4k/index.d.ts`,
  `dist/engines/anime4k/catalog.d.ts`).
  Build requires Node `^20.19.0 || >=22.12.0`. **`dist/` is gitignored build output — never edit
  or commit it**; `main`/`types` point there, so it only exists after a build.
- `verify` chains build, `check:preset-parity`, `check:packaging`, `lint` and `format:check`. Run
  it (or the individual `check:*` scripts) after packaging / entry-point changes.
- `scripts/` now contains only the parity/packaging harnesses (`check-preset-parity.cjs`,
  `check-packaging.cjs`), written as `.cjs` because the package is `"type": "module"`. Both
  `scripts/` and `vite.config.ts` are ESLint-ignored.
- `examples/` is excluded from `tsconfig.json` and the flat-config `ignores`; `scripts/` and
  `vite.config.ts` are ignored the same way. All of these are **not** type-checked or linted —
  don't rely on build/lint to catch issues there.
- ESLint 10 flat config (`eslint.config.mjs`) replaces the removed `.eslintrc.json` /
  `.eslintignore`: `@eslint/js` + `typescript-eslint` (`recommendedTypeChecked`) +
  `eslint-plugin-import-x` + `globals`, with type-aware linting via
  `parserOptions.projectService`. ESLint keeps logic rules only; `eslint-config-prettier` is
  layered last so Prettier owns formatting. `no-explicit-any`, `no-bitwise`, `no-unused-vars`,
  `import/extensions` and `class-methods-use-this` are relaxed/off.
- **Prettier owns formatting** (`.prettierrc.json`: `printWidth` 100, single quotes, semicolons,
  `trailingComma: "all"`, `arrowParens: "always"`, `lf`; ignores in `.prettierignore`):
  `pnpm run format` rewrites, `pnpm run format:check` gates. There is no competing stylistic
  ESLint plugin.
- `tsconfig`: TypeScript 6.0.x, `strict: true` but **`noImplicitAny: false`**, target **ES2020**,
  `moduleResolution: Bundler`. `skipLibCheck: true` is needed because TS 6.0.3's partial WebGPU
  `dom` library overlaps `@webgpu/types`; the full types remain a peer dependency. Declarations
  are emitted into `dist/` preserving the `src/` structure.

## Architecture

- Entry `src/index.ts` re-exports `./pipelines`, `./renderer`, `./engines`. The package is
  **ESM-only** (`"type": "module"`); the `exports` map exposes `.`, `./engines`,
  `./engines/anime4k`, `./engines/anime4k/catalog` and `./package.json`.
- **Tree-shaking invariant:** keep modules side-effect-free — no module-scope work (top-level
  reads/mutations/calls) and no nested `dist/package.json`. Either one makes bundlers retain
  modules and regresses `sideEffects: false`. Effect constructors are loaded through lazy
  per-effect dynamic imports (`src/engines/anime4k/constructors.ts`); keep new effects on that
  path. The Vite build preserves the per-module graph with `preserveModules`; do not let the
  config flatten to a single bundle, and keep `.wgsl` imports routed through `moduleTypes` as
  string modules.
- Pipelines implement `Anime4KPipeline` (`src/pipelines/interfaces.ts`):
  - `pass(encoder): Promise<void>` — **async, must always be awaited**.
  - `getOutputTexture()`, `updateParam(name, value)`.
  - optional `isCompute` + `recordCompute(pass)` + `getExecutionOrder()`.
- `recordPipelineList()` (`src/pipelines/recordPipelineList.ts`) is the execution path: it
  flattens composites via `getExecutionOrder()`, batches **consecutive** compute-only pipelines
  (`isCompute === true` + `recordCompute`) into one shared `GPUComputePassEncoder`, and falls
  back to `pass()` for render pipelines. New pipelines should expose `isCompute`/`recordCompute`
  so they join a shared pass.
- Layout: `src/pipelines/{restore,upscale,denoise,deblur,helpers,presets}/<Name>/index.ts` with
  WGSL in a sibling `shaders/`. New pipelines must be exported through the category barrel
  (`src/pipelines/<category>/index.ts`) and, for a new category, `src/pipelines/index.ts`.
- WGSL is imported as a plain string: `import x from './shaders/x.wgsl'`, typed by
  `declare module '*.wgsl'` in `src/type.d.ts`. Vite/Rolldown emits each as a
  `dist/**/*.wgsl.js` text module via `build.rolldownOptions.moduleTypes` (no bundler loader).
- Presets (`ModeA`…`ModeCA`) extend `PresetPipeline extends PipelineChain` and declare node
  order with `addNode` / `addUpscaleX2IfNeeded` / `addAutoDownscale`. Preset `updateParam`
  forwards to all children and swallows per-child "no param" errors (2.1.0 behavior change — it
  no longer throws).
- Auto up/downscale heuristics: `src/pipelines/helpers/AutoDownscale/index.ts`.
  `planAutoDownscale` deliberately returns `null` for target/native ratios in **[2.0x, 2.4x]**;
  this mirrors upstream preset behavior and must not be "fixed".

## Shader sources

- The WGSL sources are checked-in artifacts under `src/pipelines/**/shaders/`; they are not
  produced by the build. The upstream GLSL→WGSL porting script is no longer part of the
  repository.

## Gotchas

- `src/engines/` is the shipped algorithm-backend seam of the library: the backend
  contract/registry, the engine composer (`ComposedPipeline`), and the Anime4K
  backend/catalog/preset data. Engines are a separate ESM subpath entry (`./engines`,
  `./engines/anime4k`, `./engines/anime4k/catalog`) and are also root-exported for convenience.
  `src/engines/anime4k/catalog.ts` must stay in sync with the consuming extension's
  `AVAILABLE_EFFECTS` (`id`/`name`/`category`/`scale`).
  `Dimensions` is **deliberately not** re-exported from `src/engines/index.ts` — a second
  star-export would cause a TS2308 ambiguity with the root `Dimensions`. Do not re-add it.
- Name mismatch: npm package `anime4k-webgpu-async` vs repo `daika7ana/Anime4K-WebGPU-Async`
  (the v2 UMD global `anime4k-webgpu` was removed in 3.0.0). Public API changes require syncing
  `README.md` and `CHANGELOG.md` (Keep-a-Changelog + SemVer).
- `render()` (`src/renderer/index.ts`) waits for `loadeddata`, guards against re-entry on the
  same `<video>`, and needs a WebGPU-capable browser. `inputTexture` usage depends on the
  pipeline: render-based helpers need `RENDER_ATTACHMENT`, compute-based only `STORAGE_BINDING`
  (see README table).
