import { Avatar, Dropdown, Flex } from "antd";
import type { MenuProps } from "antd";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconChevron, IconFlower } from "../components/icons";
import { ThemeToggle } from "../components/ThemeToggle";

export function Shell() {
  const loc = useLocation();
  const navigate = useNavigate();
  const onSpine = loc.pathname.startsWith("/spine");
  const title = onSpine
    ? "Coordination Spine"
    : loc.pathname.startsWith("/intake")
      ? "New brief"
      : "Files & specs";

  const menuItems: MenuProps["items"] = [
    { key: "profile", label: "Profile", disabled: true },
    { type: "divider" },
    { key: "intake", label: "New brief" },
    { key: "spine", label: "Coordination Spine" },
    { key: "files", label: "Files & specs" },
    { type: "divider" },
    { key: "settings", label: "Settings", disabled: true },
    { key: "logout", label: "Log out", disabled: true },
  ];

  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    if (key === "intake") navigate("/intake");
    if (key === "spine") navigate("/spine");
    if (key === "files") navigate("/files");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/spine" className="brand" aria-label="Teamvinsible home">
          <IconFlower size={28} />
          <span className="brand-text">Teamvinsible</span>
        </NavLink>

        <div className="page-title">{title}</div>

        <Flex className="topbar-right" align="center" gap={10}>
          <ThemeToggle />
          <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={["click"]} placement="bottomRight">
            <button type="button" className="user-trigger" aria-haspopup="menu">
              <Avatar size={28} className="avatar-antd">
                AM
              </Avatar>
              <span className="user-name">Alex Morgan</span>
              <IconChevron size={16} />
            </button>
          </Dropdown>
        </Flex>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
