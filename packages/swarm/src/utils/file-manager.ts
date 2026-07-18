import fs from "node:fs";
import path from "node:path";
import type { Artifact, AgentRole, Phase } from "../types.js";
import { isArtifactPathAllowed, shouldSkipArtifactEntry } from "./artifacts.js";

export class FileManager {
  private workspaceDir: string;

  constructor(workspaceDir: string) {
    try {
      this.workspaceDir = fs.realpathSync.native(workspaceDir);
    } catch {
      this.workspaceDir = path.resolve(workspaceDir);
    }
    this.ensureDir(workspaceDir);
  }

  private ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  getWorkspacePath(...segments: string[]): string {
    return path.join(this.workspaceDir, ...segments);
  }

  writeArtifact(relativePath: string, content: string, role: AgentRole, phase: Phase): Artifact {
    const fullPath = this.getWorkspacePath(relativePath);
    this.ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, "utf-8");

    return {
      name: path.basename(relativePath),
      path: relativePath,
      createdBy: role,
      phase,
      timestamp: new Date().toISOString(),
    };
  }

  readArtifact(relativePath: string): string | null {
    const fullPath = this.getWorkspacePath(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  }

  readArtifactsByPattern(pattern: string): Record<string, string> {
    const results: Record<string, string> = {};

    // Normalize: "_artifacts/research/" -> "_artifacts/research"
    const dir = pattern.endsWith("/") ? pattern.slice(0, -1) : path.dirname(pattern);
    const fullDir = this.getWorkspacePath(dir);

    if (!fs.existsSync(fullDir)) return results;

    const files = fs.readdirSync(fullDir, { recursive: true });
    for (const file of files) {
      const fileName = typeof file === "string" ? file : file.toString();

      const relativePath = path.join(dir, fileName).replace(/\\/g, "/");
      if (!isArtifactPathAllowed(relativePath)) continue;
      const fullPath = this.getWorkspacePath(relativePath);
      if (fs.statSync(fullPath).isFile()) {
        results[relativePath] = fs.readFileSync(fullPath, "utf-8");
      }
    }
    return results;
  }

  writeFile(relativePath: string, content: string) {
    const fullPath = this.getWorkspacePath(relativePath);
    this.ensureDir(path.dirname(fullPath));
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  readFile(relativePath: string): string | null {
    const fullPath = this.getWorkspacePath(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    return fs.readFileSync(fullPath, "utf-8");
  }

  listFiles(dir: string = ""): string[] {
    const fullDir = this.getWorkspacePath(dir);
    if (!fs.existsSync(fullDir)) return [];

    const results: string[] = [];
    const entries = fs.readdirSync(fullDir, { recursive: true });
    for (const entry of entries) {
      const entryStr = typeof entry === "string" ? entry : entry.toString();
      if (entryStr.split(/[/\\]/).some(shouldSkipArtifactEntry)) continue;
      const fullPath = path.join(fullDir, entryStr);
      if (fs.statSync(fullPath).isFile()) {
        const relativePath = path.join(dir, entryStr).replace(/\\/g, "/");
        if (isArtifactPathAllowed(relativePath)) results.push(relativePath);
      }
    }
    return results;
  }

}
