import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { filterCommandOutput } from "../utils/output-filter.js";
import { ARTIFACT_BASE } from "../utils/artifacts.js";
import type { EvalCheck, EvalTier } from "../db/schema.js";

export interface EvalReport {
  overallScore: number;       // 0..1 weighted pass rate
  passed: boolean;            // no BLOCKING checks failed (app installs/compiles/has an entrypoint)
  checks: EvalCheck[];
  blockingFailures: EvalCheck[]; // failures that make the app dead on arrival — these gate the run
  advisoryFailures: EvalCheck[]; // failures that ship with a known-issues note instead of failing the run
}

// Decide a check's tier from its name. Blocking = the app can't install,
// compile, or has no runnable entrypoint. Everything else is advisory.
function classifyTier(name: string): EvalTier {
  const n = name.toLowerCase();
  if (/\b(install|build|typecheck)\b/.test(n)) return "blocking";
  if (/\bcargo check\b/.test(n)) return "blocking";
  if (/\bpub get\b/.test(n)) return "blocking";        // flutter pub get
  if (/\bsyntax\b/.test(n)) return "blocking";         // node --check / py_compile
  if (/app-present|html-entrypoint/.test(n)) return "blocking";
  return "advisory";
}

type AppCandidate =
  | { kind: "node-package"; dir: string }
  | { kind: "static-web"; dir: string }
  | { kind: "python"; dir: string }
  | { kind: "rust"; dir: string }
  | { kind: "go"; dir: string }
  | { kind: "flutter"; dir: string }
  | { kind: "gradle"; dir: string }
  | { kind: "ios"; dir: string };

const SKIP_DIRS = new Set([
  ".git", ".swarm", ".source-clone", "node_modules", "dist", "build", ".next", ".expo",
  "coverage", "target", ".venv", "venv", "__pycache__", ".gradle", "Pods", "DerivedData",
]);

// Layer A — deterministic evaluation. Runs objective checks against the
// generated app (install/build/typecheck/test/lint) plus artifact completeness.
// No LLM, no judgment: it answers "did the swarm produce working software?".
export class Evaluator {
  constructor(private workspaceDir: string) {}

  async evaluate(): Promise<EvalReport> {
    const checks: EvalCheck[] = [];

    checks.push(this.artifactCompleteness());

    const appDirs = this.findAppDirs();
    if (appDirs.length === 0) {
      checks.push({
        name: "app-present", passed: false, score: 0, weight: 3, tier: "blocking",
        detail: "No runnable project markers found. Expected one of: package.json, index.html, pyproject.toml, setup.py, requirements.txt, Cargo.toml, go.mod, pubspec.yaml, Gradle files, or Xcode project files.",
        durationMs: 0,
      });
    } else {
      for (const appDir of appDirs) {
        const label = appDirs.length > 1 ? `${path.basename(appDir.dir)}: ` : "";
        const checksForApp = await this.evaluateCandidate(appDir, label);
        checks.push(...checksForApp);
      }
    }

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0) || 1;
    const overallScore = checks.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight;

    // Only BLOCKING failures gate the run. Advisory failures (tests, lint,
    // analyze, artifact/runbook completeness) ship with a known-issues note.
    const blockingFailures = checks.filter((c) => c.tier === "blocking" && !c.passed);
    const advisoryFailures = checks.filter((c) => c.tier === "advisory" && !c.passed);
    const passed = checks.length > 0 && blockingFailures.length === 0;

    return { overallScore, passed, checks, blockingFailures, advisoryFailures };
  }

  // ── Per-app checks ──────────────────────────────────────────────────────

  private async evaluateCandidate(candidate: AppCandidate, label: string): Promise<EvalCheck[]> {
    switch (candidate.kind) {
      case "node-package": return this.evaluatePackageApp(candidate.dir, label);
      case "static-web": return this.evaluateStaticApp(candidate.dir, label);
      case "python": return this.evaluatePythonApp(candidate.dir, label);
      case "rust": return this.evaluateRustApp(candidate.dir, label);
      case "go": return this.evaluateGoApp(candidate.dir, label);
      case "flutter": return this.evaluateFlutterApp(candidate.dir, label);
      case "gradle": return this.evaluateGradleApp(candidate.dir, label);
      case "ios": return this.evaluateIosApp(candidate.dir, label);
    }
  }

  private async evaluatePackageApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [];

    const install = await this.runCheck(`${label}install`, 2, appDir, this.installCmd(appDir));
    checks.push(install);
    // Without a successful install, build/test can't run meaningfully.
    if (!install.passed) return checks;

    if (this.hasScript(appDir, "build")) {
      checks.push(await this.runCheck(`${label}build`, 3, appDir, this.pmRun(appDir, "build")));
    }
    if (this.hasTsConfig(appDir)) {
      checks.push(await this.runCheck(`${label}typecheck`, 2, appDir, "npx --no-install tsc --noEmit"));
    }
    if (this.hasScript(appDir, "test")) {
      checks.push(await this.runCheck(`${label}test`, 2, appDir, this.pmRun(appDir, "test")));
    }
    if (this.hasScript(appDir, "lint")) {
      checks.push(await this.runCheck(`${label}lint`, 1, appDir, this.pmRun(appDir, "lint")));
    }
    return checks;
  }

  private async evaluateStaticApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [];
    const rel = path.relative(this.workspaceDir, appDir).replace(/\\/g, "/") || ".";
    const indexPath = path.join(appDir, "index.html");
    const manifestPath = path.join(appDir, "PROJECT-MANIFEST.md");
    const jsFiles = this.listFiles(appDir).filter((file) => file.endsWith(".js"));

    checks.push({
      name: `${label}static-app-present`,
      passed: true,
      score: 1,
      weight: 3,
      tier: "blocking",
      detail: `Found static app entrypoint at ${rel}/index.html. This app has no package.json by design and should be served as static HTML/CSS/JS.`,
      durationMs: 0,
    });

    const hasManifest = fs.existsSync(manifestPath);
    checks.push({
      name: `${label}runbook`,
      passed: hasManifest,
      score: hasManifest ? 1 : 0,
      weight: 2,
      tier: "advisory",
      detail: hasManifest
        ? `Found ${rel}/PROJECT-MANIFEST.md with static-app run instructions.`
        : `Missing ${rel}/PROJECT-MANIFEST.md; QA needs install/start/test instructions for static apps too.`,
      durationMs: 0,
    });

    const hasEntrypoint = fs.existsSync(indexPath) && fs.statSync(indexPath).size > 0;
    checks.push({
      name: `${label}html-entrypoint`,
      passed: hasEntrypoint,
      score: hasEntrypoint ? 1 : 0,
      weight: 2,
      tier: "blocking",
      detail: hasEntrypoint ? `Found non-empty ${rel}/index.html.` : `Missing ${rel}/index.html.`,
      durationMs: 0,
    });

    for (const file of jsFiles) {
      checks.push(await this.runCheck(`${label}${path.basename(file)} syntax`, 2, appDir, `node --check "${path.relative(appDir, file)}"`));
    }

    const manifest = ["manifest.webmanifest", "manifest.json", "site.webmanifest"]
      .map((name) => path.join(appDir, name))
      .find((file) => fs.existsSync(file));
    if (manifest) {
      checks.push(this.validateJsonFile(`${label}pwa-manifest`, manifest, 1));
    }
    const hasServiceWorker = ["sw.js", "service-worker.js", "serviceWorker.js"]
      .some((name) => fs.existsSync(path.join(appDir, name)));
    if (manifest || hasServiceWorker) {
      checks.push(this.instantCheck(`${label}pwa-assets`, hasServiceWorker, 1,
        hasServiceWorker ? "Found service worker for PWA-style app." : "Found web manifest but no service worker file."));
    }

    return checks;
  }

  private async evaluatePythonApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "python-project-present", appDir, "Found Python project markers.")];
    checks.push(this.runbookCheck(appDir, label));
    const files = this.listFiles(appDir).filter((file) => file.endsWith(".py"));
    if (files.length === 0) {
      checks.push(this.instantCheck(`${label}python-files`, false, 2, "No Python source files found."));
      return checks;
    }
    if (await this.commandExists("python")) {
      for (const file of files.slice(0, 50)) {
        checks.push(await this.runCheck(`${label}${path.basename(file)} syntax`, 2, appDir, `python -m py_compile "${path.relative(appDir, file)}"`));
      }
      if (this.hasFile(appDir, "pytest.ini") || this.hasDir(appDir, "tests")) {
        checks.push(await this.runCheck(`${label}pytest`, 2, appDir, "python -m pytest -q"));
      }
    } else {
      checks.push(this.instantCheck(`${label}python-tool`, true, 1, "Python executable not available; skipped syntax/test commands."));
    }
    return checks;
  }

  private async evaluateRustApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "rust-project-present", appDir, "Found Cargo.toml.")];
    checks.push(this.runbookCheck(appDir, label));
    if (await this.commandExists("cargo")) {
      checks.push(await this.runCheck(`${label}cargo check`, 3, appDir, "cargo check"));
      checks.push(await this.runCheck(`${label}cargo test`, 2, appDir, "cargo test"));
    } else {
      checks.push(this.instantCheck(`${label}cargo-tool`, true, 1, "Cargo not available; skipped Rust build/test commands."));
    }
    return checks;
  }

  private async evaluateGoApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "go-project-present", appDir, "Found go.mod.")];
    checks.push(this.runbookCheck(appDir, label));
    if (await this.commandExists("go")) {
      checks.push(await this.runCheck(`${label}go test`, 3, appDir, "go test ./..."));
    } else {
      checks.push(this.instantCheck(`${label}go-tool`, true, 1, "Go toolchain not available; skipped Go tests."));
    }
    return checks;
  }

  private async evaluateFlutterApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "flutter-project-present", appDir, "Found pubspec.yaml.")];
    checks.push(this.runbookCheck(appDir, label));
    if (await this.commandExists("flutter")) {
      checks.push(await this.runCheck(`${label}flutter pub get`, 2, appDir, "flutter pub get"));
      checks.push(await this.runCheck(`${label}flutter analyze`, 2, appDir, "flutter analyze"));
      if (this.hasDir(appDir, "test")) checks.push(await this.runCheck(`${label}flutter test`, 2, appDir, "flutter test"));
    } else {
      checks.push(this.instantCheck(`${label}flutter-tool`, true, 1, "Flutter SDK not available; skipped Flutter commands."));
    }
    return checks;
  }

  private async evaluateGradleApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "gradle-project-present", appDir, "Found Gradle project markers.")];
    checks.push(this.runbookCheck(appDir, label));
    const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    if (this.hasFile(appDir, process.platform === "win32" ? "gradlew.bat" : "gradlew")) {
      checks.push(await this.runCheck(`${label}gradle test`, 2, appDir, `${gradlew} test`));
    } else if (await this.commandExists("gradle")) {
      checks.push(await this.runCheck(`${label}gradle test`, 2, appDir, "gradle test"));
    } else {
      checks.push(this.instantCheck(`${label}gradle-tool`, true, 1, "Gradle wrapper/tool not available; skipped Android/JVM build commands."));
    }
    return checks;
  }

  private async evaluateIosApp(appDir: string, label: string): Promise<EvalCheck[]> {
    const checks: EvalCheck[] = [this.presentCheck(label, "ios-project-present", appDir, "Found iOS/Xcode project markers.")];
    checks.push(this.runbookCheck(appDir, label));
    const swiftFiles = this.listFiles(appDir).filter((file) => file.endsWith(".swift"));
    checks.push(this.instantCheck(`${label}swift-files`, swiftFiles.length > 0, 2,
      swiftFiles.length > 0 ? `Found ${swiftFiles.length} Swift source file(s).` : "No Swift source files found."));
    if (await this.commandExists("xcodebuild")) {
      checks.push(this.instantCheck(`${label}xcodebuild-available`, true, 1, "xcodebuild is available; project can be validated in a macOS runner with an explicit scheme."));
    } else {
      checks.push(this.instantCheck(`${label}xcodebuild-tool`, true, 1, "xcodebuild not available in this environment; skipped iOS build commands."));
    }
    return checks;
  }

  private async runCheck(name: string, weight: number, cwd: string, command: string): Promise<EvalCheck> {
    const start = Date.now();
    const { code, output } = await this.exec(command, cwd);
    const durationMs = Date.now() - start;
    const passed = code === 0;
    const { output: detail } = filterCommandOutput(command, output, !passed);
    return {
      name, weight, passed, score: passed ? 1 : 0, durationMs, tier: classifyTier(name),
      detail: `$ ${command}\n${detail}`.slice(0, 4000),
    };
  }

  private instantCheck(name: string, passed: boolean, weight: number, detail: string): EvalCheck {
    return { name, passed, score: passed ? 1 : 0, weight, tier: classifyTier(name), detail, durationMs: 0 };
  }

  private presentCheck(label: string, name: string, appDir: string, detail: string): EvalCheck {
    const rel = path.relative(this.workspaceDir, appDir).replace(/\\/g, "/") || ".";
    return this.instantCheck(`${label}${name}`, true, 3, `${detail} Root: ${rel}`);
  }

  private runbookCheck(appDir: string, label: string): EvalCheck {
    const rel = path.relative(this.workspaceDir, appDir).replace(/\\/g, "/") || ".";
    const candidates = [
      path.join(appDir, "PROJECT-MANIFEST.md"),
      path.join(appDir, "README.md"),
      path.join(this.workspaceDir, "PROJECT-MANIFEST.md"),
      path.join(this.workspaceDir, "README.md"),
    ];
    const found = candidates.find((file) => fs.existsSync(file) && fs.statSync(file).size > 0);
    return this.instantCheck(
      `${label}runbook`,
      Boolean(found),
      2,
      found
        ? `Found runbook ${path.relative(this.workspaceDir, found).replace(/\\/g, "/")} for ${rel}.`
        : `Missing PROJECT-MANIFEST.md or README.md for ${rel}; QA needs install/start/test instructions.`,
    );
  }

  private validateJsonFile(name: string, file: string, weight: number): EvalCheck {
    try {
      JSON.parse(fs.readFileSync(file, "utf-8"));
      return this.instantCheck(name, true, weight, `Valid JSON: ${path.relative(this.workspaceDir, file).replace(/\\/g, "/")}`);
    } catch (err) {
      return this.instantCheck(name, false, weight, `Invalid JSON in ${path.relative(this.workspaceDir, file).replace(/\\/g, "/")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    const probe = process.platform === "win32" ? `where ${command}` : `command -v ${command}`;
    const { code } = await this.exec(probe, this.workspaceDir, 10_000);
    return code === 0;
  }

  // ── Artifact completeness ───────────────────────────────────────────────

  private artifactCompleteness(): EvalCheck {
    const expected = ["research", "product", "design", "architecture"];
    const found = expected.filter((d) => {
      // Support-doc dirs live under the artifact base; fall back to the legacy
      // top-level layout for projects built before the `_artifacts/` move.
      const candidates = [path.join(this.workspaceDir, ARTIFACT_BASE, d), path.join(this.workspaceDir, d)];
      return candidates.some((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());
    });
    const score = found.length / expected.length;
    return {
      name: "artifact-completeness", weight: 2, tier: "advisory",
      passed: score >= 0.75, score,
      detail: `Found ${found.length}/${expected.length} expected phase outputs: ${found.join(", ") || "none"}`,
      durationMs: 0,
    };
  }

  // ── Discovery / package-manager helpers ─────────────────────────────────

  private findAppDirs(): AppCandidate[] {
    const found = new Map<string, AppCandidate>();
    const root = path.resolve(this.workspaceDir);
    const addCandidate = (dir: string) => {
      const candidate = this.detectCandidate(dir);
      if (candidate && !found.has(candidate.dir)) found.set(candidate.dir, candidate);
    };

    const walk = (dir: string, depth: number) => {
      addCandidate(dir);
      if (depth >= 3) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      }
    };

    walk(root, 0);
    return [...found.values()];
  }

  private detectCandidate(dir: string): AppCandidate | null {
    const resolved = path.resolve(dir);
    if (this.hasFile(resolved, "package.json")) return { kind: "node-package", dir: resolved };
    if (this.hasFile(resolved, "pubspec.yaml")) return { kind: "flutter", dir: resolved };
    if (this.hasFile(resolved, "Cargo.toml")) return { kind: "rust", dir: resolved };
    if (this.hasFile(resolved, "go.mod")) return { kind: "go", dir: resolved };
    if (this.hasFile(resolved, "pyproject.toml") || this.hasFile(resolved, "setup.py") || this.hasFile(resolved, "requirements.txt")) {
      return { kind: "python", dir: resolved };
    }
    if (this.hasFile(resolved, "settings.gradle") || this.hasFile(resolved, "settings.gradle.kts") || this.hasFile(resolved, "build.gradle") || this.hasFile(resolved, "build.gradle.kts")) {
      return { kind: "gradle", dir: resolved };
    }
    if (this.listImmediate(resolved).some((name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace"))) {
      return { kind: "ios", dir: resolved };
    }
    if (this.hasFile(resolved, "index.html")) return { kind: "static-web", dir: resolved };
    return null;
  }

  private listFiles(dir: string): string[] {
    const files: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    };
    try { walk(dir); } catch { /* ignore */ }
    return files;
  }

  private listImmediate(dir: string): string[] {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private hasFile(dir: string, name: string): boolean {
    const file = path.join(dir, name);
    return fs.existsSync(file) && fs.statSync(file).isFile();
  }

  private hasDir(dir: string, name: string): boolean {
    const child = path.join(dir, name);
    return fs.existsSync(child) && fs.statSync(child).isDirectory();
  }

  private readPackageJson(appDir: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf-8"));
    } catch {
      return {};
    }
  }

  private hasScript(appDir: string, script: string): boolean {
    const pkg = this.readPackageJson(appDir);
    const scripts = (pkg.scripts as Record<string, string>) || {};
    return typeof scripts[script] === "string" && scripts[script].trim().length > 0;
  }

  private hasTsConfig(appDir: string): boolean {
    return fs.existsSync(path.join(appDir, "tsconfig.json"));
  }

  private packageManager(appDir: string): "pnpm" | "yarn" | "npm" {
    if (fs.existsSync(path.join(appDir, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(appDir, "yarn.lock"))) return "yarn";
    return "npm";
  }

  private installCmd(appDir: string): string {
    const pm = this.packageManager(appDir);
    if (pm === "pnpm") return "pnpm install --prefer-offline";
    if (pm === "yarn") return "yarn install";
    return "npm install --no-audit --no-fund";
  }

  private pmRun(appDir: string, script: string): string {
    const pm = this.packageManager(appDir);
    return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
  }

  private exec(command: string, cwd: string, timeoutMs = 240_000): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, { cwd, shell: true, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const cap = 200_000;
      proc.stdout.on("data", (d: Buffer) => { if (stdout.length < cap) stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { if (stderr.length < cap) stderr += d.toString(); });
      // Generous cap: installs/builds can be slow. 4 minutes per check.
      const timeout = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({ code: 124, output: `${stdout}\n${stderr}\n[eval] timed out after ${Math.round(timeoutMs / 1000)}s` });
      }, timeoutMs);
      proc.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ code: code ?? 1, output: stdout + (stderr ? `\n${stderr}` : "") });
      });
      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ code: 1, output: `Failed to run: ${err.message}` });
      });
    });
  }
}
