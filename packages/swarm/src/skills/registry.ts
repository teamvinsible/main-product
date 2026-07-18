import fs from "node:fs";
import path from "node:path";
import { envList } from "../config/env-schema.js";

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  tags: string[];
}

const SKILL_FILE = "SKILL.md";

function parseFrontmatter(raw: string): { description: string; tags: string[] } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    const firstLine = raw.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
    return { description: firstLine?.trim().slice(0, 200) || "", tags: [] };
  }
  const block = match[1];
  let description = "";
  const tags: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    const d = line.match(/^description:\s*(.+)/i);
    if (d) description = d[1].trim().replace(/^["']|["']$/g, "");
    const t = line.match(/^tags:\s*\[([^\]]*)\]/i);
    if (t) {
      tags.push(...t[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean));
    }
  }
  if (!description) {
    const heading = raw.match(/^#\s+(.+)/m);
    description = heading?.[1]?.trim() || "";
  }
  return { description, tags };
}

function scanSkillsDir(dir: string, into: Map<string, SkillEntry>): void {
  if (!fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dir, ent.name, SKILL_FILE);
    if (!fs.existsSync(skillPath)) continue;
    try {
      const raw = fs.readFileSync(skillPath, "utf-8");
      const meta = parseFrontmatter(raw);
      into.set(ent.name, {
        name: ent.name,
        description: meta.description || `Skill: ${ent.name}`,
        path: skillPath,
        tags: meta.tags,
      });
    } catch {
      // skip unreadable
    }
  }
}

/** Discover skills from repo, swarm dir, workspace, and SWARM_SKILLS_PATHS. */
export function discoverSkills(args: {
  repoRoot: string;
  workspaceDir: string;
}): SkillEntry[] {
  const map = new Map<string, SkillEntry>();
  const repo = path.resolve(args.repoRoot);
  const workspace = path.resolve(args.workspaceDir);

  // Lowest priority first — later paths override same name
  scanSkillsDir(path.join(repo, "skills"), map);
  scanSkillsDir(path.join(repo, ".swarm", "skills"), map);
  scanSkillsDir(path.join(workspace, "skills"), map);
  for (const extra of envList("SWARM_SKILLS_PATHS")) {
    scanSkillsDir(path.resolve(extra), map);
  }
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) scanSkillsDir(path.join(home, ".swarm", "skills"), map);

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkillBody(entry: SkillEntry): string {
  const raw = fs.readFileSync(entry.path, "utf-8");
  const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  return stripped.trim();
}

export function formatSkillsCatalog(skills: SkillEntry[]): string {
  if (!skills.length) return "(no skills installed — add SKILL.md under skills/ or .swarm/skills/)";
  return skills.map((s) => {
    const tags = s.tags.length ? ` [${s.tags.join(", ")}]` : "";
    return `- ${s.name}${tags}: ${s.description}`;
  }).join("\n");
}
