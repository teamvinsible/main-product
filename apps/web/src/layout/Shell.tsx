import { App, Avatar, Button, Dropdown, Flex, Modal, Tag } from "antd";
import type { MenuProps } from "antd";
import { useCallback, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { isMockMode } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { useBrief } from "../components/BriefProvider";
import { SettingsDrawer } from "../components/SettingsDrawer";
import { BrandLogo } from "../components/BrandLogo";
import { IconChevron } from "../components/icons";
import {
  clearWorkspacePrefs,
  initialsFrom,
  readWorkspacePrefs,
  type WorkspacePrefs,
} from "../lib/workspacePrefs";

export function Shell() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const demo = isMockMode();
  const { user, configured, logout } = useAuth();
  const { openBrief } = useBrief();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => readWorkspacePrefs());

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const menuItems: MenuProps["items"] = [
    { key: "settings", label: "Settings" },
    { type: "divider" },
    { key: "logout", label: "Log out", danger: true },
  ];

  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "settings") {
      openSettings();
      return;
    }
    if (key === "logout") {
      Modal.confirm({
        title: "Log out?",
        content: configured
          ? "You’ll need to sign in again to continue."
          : "This clears local workspace preferences for the demo session.",
        okText: "Log out",
        okButtonProps: { danger: true },
        cancelText: "Stay",
        onOk: async () => {
          clearWorkspacePrefs();
          setPrefs(readWorkspacePrefs());
          await logout();
          message.success("Logged out");
          navigate("/");
        },
      });
    }
  };

  const displayName = user?.displayName || prefs.displayName || "Workspace";
  const workspaceLabel = prefs.workspaceName || displayName;
  const avatar = initialsFrom(displayName);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <NavLink to="/dashboard" className="brand" aria-label="Teamvinsible home">
            <BrandLogo />
          </NavLink>
          {demo && (
            <Tag className="demo-tag" color="processing">
              Demo data
            </Tag>
          )}
        </div>

        <Flex className="topbar-right" align="center" gap={8}>
          <Button type="primary" size="middle" onClick={openBrief}>
            New brief
          </Button>
          <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={["click"]} placement="bottomRight">
            <button type="button" className="user-trigger" aria-label="Account menu" aria-haspopup="menu">
              <Avatar size={26} className="avatar-antd" src={user?.avatarUrl || undefined}>
                {avatar}
              </Avatar>
              <span className="user-name">{workspaceLabel}</span>
              <IconChevron size={14} />
            </button>
          </Dropdown>
        </Flex>
      </header>
      <main className="main">
        <Outlet />
      </main>

      <SettingsDrawer open={settingsOpen} onClose={closeSettings} onPrefsChange={setPrefs} />
    </div>
  );
}
