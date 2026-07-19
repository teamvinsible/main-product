import { ConfigProvider, theme as antdTheme, App as AntApp } from "antd";
import type { ThemeConfig } from "antd";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTheme } from "./theme";

const fontFamily =
  '"DM Sans", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

function buildTheme(isDark: boolean): ThemeConfig {
  const primary = isDark ? "#E8A84E" : "#B8750A";
  const border = isDark ? "#2A2520" : "#E0D8CC";
  const container = isDark ? "#1A1712" : "#FDFAF5";
  const elevated = isDark ? "#201D18" : "#FDFAF5";
  const layout = isDark ? "#0E0C0A" : "#EDE8E0";

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontFamily,
      colorPrimary: primary,
      colorSuccess: isDark ? "#4ecf8f" : "#0f8a5f",
      colorWarning: isDark ? "#e8a94b" : "#b86a12",
      colorError: isDark ? "#f07a80" : "#c23b3b",
      colorInfo: primary,
      colorBgBase: layout,
      colorBgContainer: container,
      colorBgElevated: elevated,
      colorBgLayout: layout,
      colorText: isDark ? "#F2EDE6" : "#1A1208",
      colorTextSecondary: isDark ? "#A8A09A" : "#4A3D2E",
      colorTextTertiary: isDark ? "#6E6560" : "#8A7D6E",
      colorBorder: border,
      colorBorderSecondary: isDark ? "#352F28" : "#CFC5B5",
      borderRadius: 12,
      borderRadiusLG: 24,
      borderRadiusSM: 10,
      controlHeight: 34,
      controlHeightSM: 28,
      fontSize: 15,
      fontSizeHeading5: 15,
      fontSizeLG: 16,
      lineHeight: 1.5,
      lineWidth: 1,
      motionDurationMid: "0.15s",
      wireframe: false,
      boxShadow: isDark
        ? "0 1px 0 rgba(255,255,255,0.06) inset, 0 16px 40px rgba(0,0,0,0.55)"
        : "0 1px 0 rgba(255,255,255,0.85) inset, 0 10px 32px rgba(26,18,8,0.08)",
      boxShadowSecondary: isDark
        ? "0 20px 50px rgba(0,0,0,0.6)"
        : "0 16px 40px rgba(26,18,8,0.1)",
    },
    components: {
      Button: {
        fontWeight: 600,
        controlHeight: 34,
        controlHeightSM: 28,
        paddingInline: 14,
        paddingInlineSM: 10,
        borderRadius: 12,
        primaryShadow: "none",
        defaultShadow: "none",
        primaryColor: "#1A1208",
      },
      Segmented: {
        trackBg: isDark ? "#1A1712" : "#EDE8E0",
        itemSelectedBg: isDark ? "#201D18" : "#FDFAF5",
        itemSelectedColor: isDark ? "#F2EDE6" : "#1A1208",
        trackPadding: 3,
        controlHeight: 32,
        controlHeightSM: 28,
        borderRadius: 14,
        borderRadiusSM: 12,
      },
      Modal: {
        borderRadiusLG: 24,
        titleFontSize: 18,
        paddingContentHorizontalLG: 22,
        paddingMD: 18,
      },
      Select: {
        controlHeight: 34,
        controlHeightSM: 28,
        borderRadius: 12,
      },
      Dropdown: {
        borderRadiusLG: 14,
        paddingBlock: 6,
        controlItemBgHover: isDark ? "rgba(232,168,78,0.12)" : "rgba(184,117,10,0.08)",
      },
      Table: {
        headerBg: isDark ? "rgba(255,255,255,0.03)" : "rgba(253,250,245,0.7)",
        headerColor: isDark ? "#6E6560" : "#8A7D6E",
        borderColor: border,
        rowHoverBg: isDark ? "rgba(232,168,78,0.08)" : "rgba(255,255,255,0.55)",
        cellPaddingBlockSM: 12,
        cellPaddingInlineSM: 14,
        borderRadius: 14,
      },
      Tag: {
        borderRadiusSM: 999,
      },
      Input: {
        controlHeight: 34,
        controlHeightSM: 28,
        borderRadius: 12,
        activeShadow: `0 0 0 3px ${isDark ? "rgba(232,168,78,0.22)" : "rgba(184,117,10,0.14)"}`,
      },
    },
  };
}

export function AntDesignProvider({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const theme = useMemo(() => buildTheme(resolved === "dark"), [resolved]);

  return (
    <ConfigProvider theme={theme}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  );
}
