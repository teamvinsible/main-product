import { Segmented, Tooltip } from "antd";
import { useTheme, type ThemePreference } from "../theme";
import { IconMonitor, IconMoon, IconSun } from "./icons";

const OPTIONS: Array<{
  value: ThemePreference;
  title: string;
  icon: typeof IconSun;
}> = [
  { value: "system", title: "System", icon: IconMonitor },
  { value: "light", title: "Light", icon: IconSun },
  { value: "dark", title: "Dark", icon: IconMoon },
];

export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <Tooltip
      title={`Theme: ${preference}${preference === "system" ? ` (${resolved})` : ""}`}
      placement="bottom"
    >
      <Segmented
        className="theme-toggle-antd"
        size="small"
        value={preference}
        onChange={(next) => setPreference(next as ThemePreference)}
        options={OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return {
            value: opt.value,
            icon: <Icon size={14} />,
            title: opt.value === "system" ? `System (${resolved})` : opt.title,
          };
        })}
      />
    </Tooltip>
  );
}
