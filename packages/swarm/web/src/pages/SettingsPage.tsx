import { useEffect, useMemo, useState } from "react";
import { Clipboard, Play, Send, ShieldCheck, Square, Terminal, X } from "lucide-react";
import { api } from "../api";
import { useConfig } from "../config";
import { usePoll } from "../hooks";
import { Field, useToast } from "../ui";
import type { EnvVar, McpConfig, ProjectEntry, PromptItem, PromptKind, Settings, TerminalSession } from "../types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SettingsPage() {
  return (
    <div className="grid gap-4 p-7 lg:grid-cols-2 lg:p-8">
      <Card><CardContent className="p-4"><KeysAndEnv /></CardContent></Card>
      <Card><CardContent className="p-4"><DeployCredentials /></CardContent></Card>
      <Card className="lg:col-span-2"><CardContent className="p-4"><AgentToolsGuide /></CardContent></Card>
      <Card className="lg:col-span-2"><CardContent className="p-4"><TerminalSessions /></CardContent></Card>
      <Card className="lg:col-span-2"><CardContent className="p-4"><Prompts /></CardContent></Card>
    </div>
  );
}

const MCP_TEMPLATES = {
  supabase: `{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "\${SUPABASE_ACCESS_TOKEN}"
      }
    }
  }
}`,
  filesystem: `{
  "mcpServers": {
    "workspace-files": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "."
      ]
    }
  }
}`,
  browser: `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}`,
};

const CLI_GUIDES = [
  {
    name: "Supabase CLI",
    install: "npm install -g supabase",
    verify: "supabase --version",
    env: ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"],
    use: "Migration status, local validation, seed scripts, and approved migration applies.",
  },
  {
    name: "Cloudflare Wrangler",
    install: "npm install -g wrangler",
    verify: "wrangler --version",
    env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    use: "Pages deploys, DNS checks, cache purge, and preview environment setup.",
  },
];

function OnOff({ value, onChange }: { value: "on" | "off"; onChange: (v: "on" | "off") => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v === "on" ? "on" : "off")}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="off">Off</SelectItem>
        <SelectItem value="on">On</SelectItem>
      </SelectContent>
    </Select>
  );
}

function KeysAndEnv() {
  const [settings, setSettings] = useState<Settings>({});
  const [deepseek, setDeepseek] = useState("");
  const [deepseekUrl, setDeepseekUrl] = useState("");
  const [anthropic, setAnthropic] = useState("");
  const [openrouter, setOpenrouter] = useState("");
  const [openrouterUrl, setOpenrouterUrl] = useState("");
  const [github, setGithub] = useState("");
  const [githubProfile, setGithubProfile] = useState("default");
  const [worktrees, setWorktrees] = useState<"off" | "on">("off");
  const [ciRepair, setCiRepair] = useState<"off" | "on">("off");
  const [ciRepairRounds, setCiRepairRounds] = useState("3");
  const [ciRepairTimeoutMs, setCiRepairTimeoutMs] = useState("1200000");
  const [sandbox, setSandbox] = useState<"off" | "exec" | "full">("off");
  const [sandboxImage, setSandboxImage] = useState("node:22-bookworm");
  const [sandboxCpus, setSandboxCpus] = useState("");
  const [sandboxMemory, setSandboxMemory] = useState("");
  const [mcp, setMcp] = useState<McpConfig | null>(null);
  const [mcpContent, setMcpContent] = useState("");
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [envKey, setEnvKey] = useState("");
  const [envVal, setEnvVal] = useState("");
  const set = useToast();
  const envToast = useToast();

  useEffect(() => {
    api.settings().then((s) => {
      setSettings(s);
      setWorktrees(s.swarmWorktrees || "off");
      setCiRepair(s.swarmCiRepair || "off");
      setCiRepairRounds(s.swarmCiRepairRounds || "3");
      setCiRepairTimeoutMs(s.swarmCiRepairTimeoutMs || "1200000");
      setSandbox(s.swarmSandbox || "off");
      setSandboxImage(s.swarmSandboxImage || "node:22-bookworm");
      setSandboxCpus(s.swarmSandboxCpus || "");
      setSandboxMemory(s.swarmSandboxMemory || "");
    }).catch(() => {});
    api.env().then(setVars).catch(() => {});
    api.mcp().then((cfg) => { setMcp(cfg); setMcpContent(cfg.content); }).catch(() => {});
  }, []);

  const save = async () => {
    const res = await api.saveSettings({
      deepseekKey: deepseek.trim(), deepseekBaseUrl: deepseekUrl.trim(),
      openrouterKey: openrouter.trim(), openrouterBaseUrl: openrouterUrl.trim(),
      anthropicKey: anthropic.trim(), githubToken: githubProfile === "default" ? github.trim() : "",
      githubProfile, githubProfileToken: githubProfile !== "default" ? github.trim() : "",
      swarmWorktrees: worktrees,
      swarmCiRepair: ciRepair, swarmCiRepairRounds: ciRepairRounds.trim(), swarmCiRepairTimeoutMs: ciRepairTimeoutMs.trim(),
      swarmSandbox: sandbox, swarmSandboxImage: sandboxImage.trim(), swarmSandboxCpus: sandboxCpus.trim(), swarmSandboxMemory: sandboxMemory.trim(),
    });
    if (res.ok) { set.show("Settings saved.", true); setDeepseek(""); setAnthropic(""); setOpenrouter(""); setGithub(""); setSettings(res.data); }
    else set.show(res.data.error || "Failed to save.", false);
  };

  const addVar = async () => {
    if (!envKey.trim()) return envToast.show("Enter a variable name.", false);
    const res = await api.saveEnv({ set: { [envKey.trim()]: envVal } });
    if (res.ok) { envToast.show("Saved " + envKey, true); setEnvKey(""); setEnvVal(""); setVars(res.data.vars); }
    else envToast.show(res.data.error || "Failed to save.", false);
  };

  const removeVar = async (key: string) => {
    const res = await api.saveEnv({ remove: [key] });
    if (res.ok) setVars(res.data.vars);
  };

  const saveMcp = async () => {
    const res = await api.saveMcp({ content: mcpContent });
    if (res.ok) { setMcp(res.data); setMcpContent(res.data.content); envToast.show("MCP config saved.", true); }
    else envToast.show(res.data.error || "Invalid MCP config.", false);
  };

  const useMcpTemplate = (template: keyof typeof MCP_TEMPLATES) => {
    setMcpContent(MCP_TEMPLATES[template]);
    envToast.show("Template loaded. Review it, then save MCP config.", true);
  };

  return (
    <>
      <h2 className="mb-1 text-base font-semibold">Settings — API Keys</h2>
      <p className="mb-3 text-xs text-muted-foreground">Keys are saved to a local <code>.env</code> in the project root and never leave your machine. Claude also works via your Claude Code login if no key is set.</p>

      <Field label="DeepSeek API Key" hint="Required for DeepSeek agents. Get one at platform.deepseek.com">
        <KeyStatus on={settings.deepseekKeySet} />
        <Input type="password" value={deepseek} onChange={(e) => setDeepseek(e.target.value)} placeholder="sk-..." />
      </Field>
      <Field label="DeepSeek Base URL">
        <Input value={deepseekUrl} onChange={(e) => setDeepseekUrl(e.target.value)} placeholder={settings.deepseekBaseUrl || "https://api.deepseek.com"} />
      </Field>
      <Field label="Anthropic API Key">
        <KeyStatus on={settings.anthropicKeySet} />
        <Input type="password" value={anthropic} onChange={(e) => setAnthropic(e.target.value)} placeholder="optional — uses Claude Code login if blank" />
      </Field>
      <Field label="OpenRouter API Key" hint="Required for the openrouter provider. One key fronts many models. Get one at openrouter.ai/keys">
        <KeyStatus on={settings.openrouterKeySet} />
        <Input type="password" value={openrouter} onChange={(e) => setOpenrouter(e.target.value)} placeholder="sk-or-..." />
      </Field>
      <Field label="OpenRouter Base URL">
        <Input value={openrouterUrl} onChange={(e) => setOpenrouterUrl(e.target.value)} placeholder={settings.openrouterBaseUrl || "https://openrouter.ai/api/v1"} />
      </Field>
      <Field label="GitHub Token (PAT)" hint="Required to commit/push builds. Create at github.com/settings/tokens">
        <KeyStatus on={settings.githubTokenSet} />
        <Input value={githubProfile} onChange={(e) => setGithubProfile(e.target.value.trim() || "default")} placeholder="profile name, e.g. default or client-a" />
        <Input type="password" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="ghp_... (needs 'repo' scope)" />
        <div className="text-[11px] text-muted-foreground">Profiles configured: {(settings.gitProfiles || []).map((p) => `${p.name}${p.tokenSet ? "" : " (missing)"}`).join(", ") || "default"}</div>
      </Field>
      <Field label="Parallel Git Worktrees" hint="Opt-in isolation for parallel development agents. Falls back automatically if unavailable.">
        <OnOff value={worktrees} onChange={setWorktrees} />
      </Field>
      <Field label="CI Repair Loop" hint="After opening a PR, poll failed checks and PR review comments, rerun development agents, and push fixes. Needs PAT access to actions and pull requests.">
        <OnOff value={ciRepair} onChange={setCiRepair} />
      </Field>
      <Field label="CI Repair Rounds">
        <Input value={ciRepairRounds} onChange={(e) => setCiRepairRounds(e.target.value)} placeholder="3" />
      </Field>
      <Field label="CI Repair Timeout (ms)">
        <Input value={ciRepairTimeoutMs} onChange={(e) => setCiRepairTimeoutMs(e.target.value)} placeholder="1200000" />
      </Field>
      <Field label="Docker Sandbox" hint="Off by default. Exec runs DeepSeek shell commands inside Docker; full is reserved for whole-run sandboxing.">
        <Select value={sandbox} onValueChange={(v) => setSandbox(v === "exec" || v === "full" ? v : "off")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="off">Off</SelectItem>
            <SelectItem value="exec">Exec</SelectItem>
            <SelectItem value="full">Full</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Sandbox Image"><Input value={sandboxImage} onChange={(e) => setSandboxImage(e.target.value)} placeholder="node:22-bookworm" /></Field>
      <Field label="Sandbox CPUs"><Input value={sandboxCpus} onChange={(e) => setSandboxCpus(e.target.value)} placeholder="optional, e.g. 2" /></Field>
      <Field label="Sandbox Memory"><Input value={sandboxMemory} onChange={(e) => setSandboxMemory(e.target.value)} placeholder="optional, e.g. 4g" /></Field>
      <Field label="MCP Servers" hint="Global mcp.json. Project workspaces can also define their own mcp.json, which overrides matching server names.">
        <div className="mb-2 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => useMcpTemplate("supabase")}>Supabase MCP</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => useMcpTemplate("filesystem")}>Workspace files MCP</Button>
          <Button type="button" variant="outline" size="sm" onClick={() => useMcpTemplate("browser")}>Browser MCP</Button>
        </div>
        <Textarea rows={8} className="font-mono" value={mcpContent} onChange={(e) => setMcpContent(e.target.value)} />
        <div className="text-[11px] text-muted-foreground">{mcp?.path || "mcp.json"}</div>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={saveMcp}>Save MCP Config</Button>
        <Button variant="secondary" size="sm" onClick={save}>Save Settings</Button>
      </div>

      <div className="mt-5">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Global Environment Variables</div>
        <div className="mb-2 text-[11px] text-muted-foreground">Shared KEY=VALUE applied to <strong>all</strong> projects (e.g. <code>DATABASE_URL</code>, API keys). A project can override any of these on its Environment tab.</div>
        <div className="mb-2 flex flex-col gap-1.5">
          {vars.length ? vars.map((v) => (
            <div key={v.key} className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
              <strong className="font-mono">{v.key}</strong><span className="flex-1 truncate text-muted-foreground">{v.preview}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" title="Remove" onClick={() => removeVar(v.key)}><X className="h-3.5 w-3.5" /></Button>
            </div>
          )) : <div className="text-xs text-muted-foreground">No variables set.</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input className="w-40" value={envKey} onChange={(e) => setEnvKey(e.target.value)} placeholder="KEY" />
          <Input className="w-56" value={envVal} onChange={(e) => setEnvVal(e.target.value)} placeholder="value" />
          <Button variant="secondary" size="sm" onClick={addVar}>Add</Button>
        </div>
      </div>
    </>
  );
}

function KeyStatus({ on }: { on?: boolean }) {
  return <Badge variant={on ? "success" : "secondary"} className="mb-1">{on ? "set" : "not set"}</Badge>;
}

function AgentToolsGuide() {
  const toast = useToast();

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show("Copied.", true);
    } catch {
      toast.show("Copy failed.", false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-base font-semibold">Agent Tools: CLIs and MCPs</h2>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
            Give agents narrow capabilities through local CLIs, MCP servers, and scoped environment variables. Keep secrets in Settings or project Environment tabs; agents should use status and dry-run operations first, then require human approval for production writes.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">local only</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {CLI_GUIDES.map((tool) => (
          <div key={tool.name} className="rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex items-center gap-2">
              <Terminal className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{tool.name}</h3>
            </div>
            <p className="mb-3 min-h-10 text-xs leading-relaxed text-muted-foreground">{tool.use}</p>
            <GuideCommand label="Install" value={tool.install} onCopy={copy} />
            <GuideCommand label="Verify" value={tool.verify} onCopy={copy} />
            <div className="mt-3 text-[11px] text-muted-foreground">Env vars:</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {tool.env.map((key) => <Badge key={key} variant="outline" className="font-mono">{key}</Badge>)}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-background p-3">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-success" />
            <h3 className="text-sm font-semibold">Safe Agent Access Policy</h3>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>Use status/list/dry-run commands before any write operation.</li>
            <li>Use separate staging and production credentials or profiles.</li>
            <li>Require human approval for migrations, production deploys, DNS, deletes, and paid resources.</li>
            <li>Prefer MCP/wrapper tools over arbitrary shell commands for cloud operations.</li>
            <li>Record target environment, command, approval, result, and rollback note in logs.</li>
          </ul>
        </div>

        <div className="rounded-md border border-border bg-background p-3">
          <h3 className="mb-2 text-sm font-semibold">Recommended Setup Order</h3>
          <ol className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <li>1. Install the CLI locally and verify it from a terminal.</li>
            <li>2. Add tokens and project IDs in Global Environment Variables or the project Environment tab.</li>
            <li>3. Add MCP servers in the MCP editor above only when they provide useful typed tools.</li>
            <li>4. Run a read-only status check through chat before allowing write operations.</li>
            <li>5. Bind deploy credentials per project on the project Deploy tab.</li>
          </ol>
        </div>
      </div>
    </>
  );
}

function GuideCommand({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5">
      <span className="w-12 shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-[11px]">{value}</code>
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" title={`Copy ${label.toLowerCase()} command`} onClick={() => onCopy(value)}>
        <Clipboard className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function TerminalSessions() {
  const { data: sessions } = usePoll<TerminalSession[]>(api.terminals, 1000, []);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("CLI auth");
  const [command, setCommand] = useState("supabase login");
  const [cwd, setCwd] = useState(".swarm/workspaces");
  const [shell, setShell] = useState("powershell");
  const [input, setInput] = useState("");
  const toast = useToast();

  const selected = (sessions ?? []).find((s) => s.id === selectedId) || (sessions ?? [])[0];

  useEffect(() => {
    if (!selectedId && sessions?.[0]) setSelectedId(sessions[0].id);
  }, [sessions, selectedId]);

  const start = async () => {
    const res = await api.startTerminal({ name, command, cwd, shell });
    if (res.ok && res.data.session) {
      setSelectedId(res.data.session.id);
      toast.show("Terminal session started.", true);
    } else {
      toast.show(res.data.error || "Failed to start terminal.", false);
    }
  };

  const send = async (text = input) => {
    if (!selected || !text) return;
    const res = await api.sendTerminal({ id: selected.id, input: text });
    if (res.ok) setInput("");
    else toast.show(res.data.error || "Failed to send input.", false);
  };

  const stop = async () => {
    if (!selected) return;
    const res = await api.stopTerminal({ id: selected.id });
    if (res.ok) toast.show("Terminal stopped.", true);
    else toast.show(res.data.error || "Failed to stop terminal.", false);
  };

  const preset = (next: { name: string; command: string }) => {
    setName(next.name);
    setCommand(next.command);
  };

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="mb-1 text-base font-semibold">Terminal Sessions</h2>
          <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
            Start a local shell for CLI auth, menus, and provider setup. Use this for device-code logins and status checks; production writes, migrations, DNS, deletes, and paid infrastructure should still require human approval.
          </p>
        </div>
        {selected && <Badge variant={selected.status === "running" ? "success" : "secondary"}>{selected.status}</Badge>}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => preset({ name: "Supabase login", command: "supabase login" })}>Supabase login</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => preset({ name: "Supabase projects", command: "supabase projects list" })}>Supabase projects</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => preset({ name: "Cloudflare login", command: "wrangler login" })}>Wrangler login</Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <Field label="Session name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Command">
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="supabase login" />
          </Field>
          <Field label="Working directory" hint="Must stay inside the swarm project/workspace.">
            <Input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder=".swarm/workspaces/project-name" />
          </Field>
          <Field label="Shell">
            <Select value={shell} onValueChange={setShell}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="powershell">PowerShell</SelectItem>
                <SelectItem value="cmd">cmd</SelectItem>
                <SelectItem value="bash">bash/sh</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={start}>
              <Play className="mr-1 h-3.5 w-3.5" /> Start
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={stop} disabled={!selected || selected.status !== "running"}>
              <Square className="mr-1 h-3.5 w-3.5 fill-current" /> Stop
            </Button>
          </div>

          <div className="rounded-md border border-border bg-background">
            {(sessions ?? []).length ? (sessions ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-left text-xs last:border-b-0 ${selected?.id === s.id ? "bg-primary/10" : ""}`}
                onClick={() => setSelectedId(s.id)}
              >
                <span className="min-w-0 truncate">{s.name}</span>
                <Badge variant={s.status === "running" ? "success" : "secondary"}>{s.shell}</Badge>
              </button>
            )) : <div className="px-3 py-6 text-center text-xs text-muted-foreground">No terminal sessions.</div>}
          </div>
        </div>

        <div className="flex min-h-[420px] flex-col rounded-md border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{selected ? `${selected.cwd} - pid ${selected.pid}` : "No session selected"}</span>
            {selected?.exitCode != null && <span>exit {selected.exitCode}</span>}
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">
            {selected?.output || "Start a session to see terminal output."}
          </pre>
          <div className="flex gap-2 border-t border-border p-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void send(input + "\n");
                }
              }}
              placeholder="Type input, menu selection, y/n, or paste device-code response..."
              disabled={!selected || selected.status !== "running"}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => send(input + "\n")} disabled={!selected || selected.status !== "running" || !input}>
              <Send className="mr-1 h-3.5 w-3.5" /> Send
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => send("\u0003")} disabled={!selected || selected.status !== "running"}>
              Ctrl+C
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// Per-provider deploy tokens, saved to .env under a credential profile.
function DeployCredentials() {
  const { deployProviders } = useConfig();
  const providers = deployProviders ?? [];
  const [settings, setSettings] = useState<Settings>({});
  const [provider, setProvider] = useState("");
  const [profile, setProfile] = useState("default");
  const [values, setValues] = useState<Record<string, string>>({});
  const toast = useToast();

  useEffect(() => { api.settings().then(setSettings).catch(() => {}); }, []);
  useEffect(() => { if (!provider && providers[0]) setProvider(providers[0].key); }, [providers, provider]);

  const spec = providers.find((p) => p.key === provider);
  const secretBases = spec?.secrets || [];
  const configBases = spec?.config || [];
  const profilesForProvider = (settings.deployProfiles || []).filter((p) => p.provider === provider);

  const save = async () => {
    const deploySecrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v.trim()) deploySecrets[k] = v.trim();
    if (!Object.keys(deploySecrets).length) return toast.show("Enter at least one value.", false);
    const res = await api.saveSettings({ deployProvider: provider, deployProfile: profile, deploySecrets });
    if (res.ok) { toast.show("Deploy credentials saved.", true); setValues({}); setSettings(res.data); }
    else toast.show(res.data.error || "Failed to save.", false);
  };

  return (
    <>
      <h2 className="mb-1 text-base font-semibold">Settings — Deploy Credentials</h2>
      <p className="mb-3 text-xs text-muted-foreground">Provider tokens saved to the local <code>.env</code> under a profile (e.g. <code>VERCEL_TOKEN_CLIENTA</code>). A project can override any of these on its Environment tab, so each project deploys with isolated credentials.</p>
      <Field label="Provider">
        <Select value={provider || undefined} onValueChange={setProvider}>
          <SelectTrigger><SelectValue placeholder="Select a provider…" /></SelectTrigger>
          <SelectContent>
            {providers.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Credential profile" hint="default uses the bare env var; a named profile appends _<PROFILE>. Bind a project to a profile on its Deploy tab.">
        <Input value={profile} onChange={(e) => setProfile(e.target.value.trim() || "default")} placeholder="default or client-a" />
      </Field>
      {secretBases.map((base) => (
        <Field key={base} label={base}>
          <Input type="password" value={values[base] || ""} onChange={(e) => setValues({ ...values, [base]: e.target.value })} placeholder={`${base} (secret)`} />
        </Field>
      ))}
      {configBases.map((base) => (
        <Field key={base} label={base} hint="optional, non-secret">
          <Input value={values[base] || ""} onChange={(e) => setValues({ ...values, [base]: e.target.value })} placeholder={base} />
        </Field>
      ))}
      <div className="mb-2 text-[11px] text-muted-foreground">Configured: {profilesForProvider.map((p) => `${p.name}${p.tokenSet ? "" : " (missing)"}`).join(", ") || "none"}</div>
      <Button variant="secondary" size="sm" onClick={save}>Save Deploy Credentials</Button>
    </>
  );
}

function promptLabel(key: string, kind: PromptKind): string {
  if (kind === "template") {
    const m: Record<string, string> = {
      "template.agentWrapper": "Agent wrapper", "template.task": "Task prompt",
      "template.taskIncremental": "Task prompt (incremental)",
    };
    return m[key] || key;
  }
  if (kind === "directive") return key === "directive.incremental" ? "Incremental directive" : key;
  return key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function Prompts() {
  const [scopes, setScopes] = useState<string[]>([]);
  const [scope, setScope] = useState("");
  const [items, setItems] = useState<PromptItem[]>([]);
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const toast = useToast();

  useEffect(() => {
    api.projects().then((ps: ProjectEntry[]) => setScopes(ps.map((p) => p.name))).catch(() => {});
  }, []);

  useEffect(() => {
    api.prompts(scope || undefined).then((r) => {
      setItems(r.items);
      setKey((k) => (k && r.items.some((it) => it.key === k) ? k : r.items[0]?.key || ""));
    }).catch(() => {});
  }, [scope]);

  const current = useMemo(() => items.find((it) => it.key === key), [items, key]);
  useEffect(() => { setContent(current?.value ?? ""); }, [current]);

  const groups = useMemo(() => {
    const g: Record<PromptKind, PromptItem[]> = { role: [], template: [], directive: [] };
    for (const it of items) (g[it.kind] || g.role).push(it);
    return g;
  }, [items]);

  const reload = () => api.prompts(scope || undefined).then((r) => setItems(r.items));

  const save = async () => {
    if (!key) return toast.show("Select a prompt first.", false);
    const res = await api.savePrompt({ project: scope, key, content });
    if (res.ok) { toast.show("Saved override for " + key + ".", true); reload(); }
    else toast.show(res.data.error || "Failed to save.", false);
  };
  const reset = async () => {
    if (!key) return toast.show("Select a prompt first.", false);
    const res = await api.resetPrompt({ project: scope, key });
    if (res.ok) { toast.show("Reset " + key + " to default.", true); reload(); }
    else toast.show(res.data.error || "Failed to reset.", false);
  };

  return (
    <>
      <h2 className="mb-1 text-base font-semibold">Prompts</h2>
      <p className="mb-3 text-xs text-muted-foreground">Override any agent prompt or template. Overrides are stored in the database and layer over the defaults (project beats global beats default). Templates use <code>{"{{placeholders}}"}</code> — keep them when editing.</p>

      <Field label="Scope" hint="Edit the global default, or override the prompt for a single project.">
        <Select value={scope || "__global__"} onValueChange={(v) => setScope(v === "__global__" ? "" : v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__global__">Global (all projects)</SelectItem>
            {scopes.map((s) => <SelectItem key={s} value={s}>Project: {s}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Prompt" hint={current?.overridden ? "● Overridden at this scope — reset to revert to default." : "Using the built-in default. Saving creates an override at this scope."}>
        <Select value={key} onValueChange={setKey}>
          <SelectTrigger><SelectValue placeholder="Select a prompt" /></SelectTrigger>
          <SelectContent>
            <PromptGroup label="Agents" items={groups.role} />
            <PromptGroup label="Templates" items={groups.template} />
            <PromptGroup label="Directives" items={groups.directive} />
          </SelectContent>
        </Select>
      </Field>
      <Field label="">
        <Textarea className="font-mono" rows={14} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Select a prompt to edit" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={save}>Save override</Button>
        <Button variant="secondary" size="sm" onClick={reset}>Reset to default</Button>
      </div>
    </>
  );
}

function PromptGroup({ label, items }: { label: string; items: PromptItem[] }) {
  if (!items.length) return null;
  return (
    <>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      {items.map((it) => (
        <SelectItem key={it.key} value={it.key}>{promptLabel(it.key, it.kind)}{it.overridden ? " ●" : ""}</SelectItem>
      ))}
    </>
  );
}
