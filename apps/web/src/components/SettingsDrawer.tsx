import { App, Button, Input, Segmented, Switch } from "antd";
import { useEffect, useState } from "react";
import { isMockMode } from "../api";
import {
  initialsFrom,
  readWorkspacePrefs,
  writeWorkspacePrefs,
  type WorkspacePrefs,
} from "../lib/workspacePrefs";
import { useTheme, type ThemePreference } from "../theme";
import { IconMonitor, IconMoon, IconSun } from "./icons";
import { OverlayDrawer } from "./OverlayDrawer";

type SettingsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onPrefsChange?: (prefs: WorkspacePrefs) => void;
};

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  icon: typeof IconSun;
}> = [
  { value: "system", label: "System", icon: IconMonitor },
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
];

export function SettingsDrawer({ open, onClose, onPrefsChange }: SettingsDrawerProps) {
  const { message } = App.useApp();
  const { preference, resolved, setPreference } = useTheme();
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => readWorkspacePrefs());
  const demo = isMockMode();

  useEffect(() => {
    if (open) setPrefs(readWorkspacePrefs());
  }, [open]);

  function update<K extends keyof WorkspacePrefs>(key: K, value: WorkspacePrefs[K]) {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      writeWorkspacePrefs(next);
      onPrefsChange?.(next);
      return next;
    });
  }

  function saveProfile() {
    writeWorkspacePrefs(prefs);
    onPrefsChange?.(prefs);
    message.success("Profile saved");
  }

  return (
    <OverlayDrawer
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Quick workspace preferences"
    >
      <section className="settings-section">
        <h3 className="settings-section-title">Profile</h3>
        <p className="settings-section-lead muted">Shown in the top bar and activity.</p>
        <label className="settings-field">
          <span className="settings-label">Display name</span>
          <Input
            value={prefs.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            placeholder="Your name"
            maxLength={48}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Workspace</span>
          <Input
            value={prefs.workspaceName}
            onChange={(e) => update("workspaceName", e.target.value)}
            placeholder="Workspace name"
            maxLength={48}
          />
        </label>
        <div className="settings-avatar-preview">
          <span className="settings-avatar-chip">{initialsFrom(prefs.displayName)}</span>
          <span className="muted">Avatar initials update from your display name.</span>
        </div>
        <Button type="primary" onClick={saveProfile}>
          Save profile
        </Button>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Appearance</h3>
        <p className="settings-section-lead muted">
          Theme follows {preference === "system" ? `system (${resolved})` : preference}.
        </p>
        <Segmented
          block
          className="settings-theme-seg"
          value={preference}
          onChange={(next) => setPreference(next as ThemePreference)}
          options={THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return {
              value: opt.value,
              label: (
                <span className="settings-theme-opt">
                  <Icon size={14} />
                  {opt.label}
                </span>
              ),
            };
          })}
        />
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Notifications</h3>
        <p className="settings-section-lead muted">Stored on this device — delivery comes later.</p>
        <div className="settings-switch-row">
          <div>
            <div className="settings-switch-label">Live agent activity</div>
            <div className="muted settings-switch-hint">Handoffs and status pings</div>
          </div>
          <Switch checked={prefs.notifyLive} onChange={(v) => update("notifyLive", v)} />
        </div>
        <div className="settings-switch-row">
          <div>
            <div className="settings-switch-label">Open decisions</div>
            <div className="muted settings-switch-hint">Blocked or needs-review items</div>
          </div>
          <Switch checked={prefs.notifyDecisions} onChange={(v) => update("notifyDecisions", v)} />
        </div>
        <div className="settings-switch-row">
          <div>
            <div className="settings-switch-label">Run ready</div>
            <div className="muted settings-switch-hint">When coordination hits Ready</div>
          </div>
          <Switch checked={prefs.notifyReady} onChange={(v) => update("notifyReady", v)} />
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">About</h3>
        <dl className="settings-about">
          <div>
            <dt>Product</dt>
            <dd>Teamvinsible Coordination Spine</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{demo ? "Demo dataset (VITE_USE_MOCK)" : "Live swarm API"}</dd>
          </div>
        </dl>
      </section>
    </OverlayDrawer>
  );
}
