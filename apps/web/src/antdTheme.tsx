import { ConfigProvider, theme as antdTheme, App as AntApp } from "antd";
import type { ThemeConfig } from "antd";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { useTheme } from "./theme";

const fontFamily =
  '"IBM Plex Sans", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

function buildTheme(isDark: boolean): ThemeConfig {
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      fontFamily,
      colorPrimary: isDark ? "#7a9cff" : "#1f4fd6",
      colorSuccess: isDark ? "#4ecf8f" : "#0f8a5f",
      colorWarning: isDark ? "#e8a94b" : "#b86a12",
      colorError: isDark ? "#f07a80" : "#c23b3b",
      colorInfo: isDark ? "#7a9cff" : "#1f4fd6",
      colorBgBase: isDark ? "#161616" : "#eef1f6",
      colorBgContainer: isDark ? "#1e1e1e" : "#ffffff",
      colorBgElevated: isDark ? "#242424" : "#ffffff",
      colorBgLayout: isDark ? "#161616" : "#eef1f6",
      colorText: isDark ? "#f2f2f2" : "#0c1222",
      colorTextSecondary: isDark ? "#b3b3b3" : "#3d4659",
      colorTextTertiary: isDark ? "#7a7a7a" : "#7a8499",
      colorBorder: isDark ? "#2e2e2e" : "#e2e7ef",
      colorBorderSecondary: isDark ? "#3d3d3d" : "#cfd6e3",
      borderRadius: 9,
      borderRadiusLG: 14,
      borderRadiusSM: 6,
      controlHeight: 32,
      controlHeightSM: 26,
      fontSize: 13,
      wireframe: false,
    },
    components: {
      Button: {
        fontWeight: 600,
        controlHeight: 32,
        controlHeightSM: 26,
        paddingInline: 14,
        paddingInlineSM: 10,
      },
      Segmented: {
        trackBg: isDark ? "#252525" : "#eef1f6",
        itemSelectedBg: isDark ? "#1e1e1e" : "#ffffff",
        itemSelectedColor: isDark ? "#f2f2f2" : "#0c1222",
        controlHeight: 28,
        controlHeightSM: 26,
        borderRadius: 8,
        borderRadiusSM: 6,
      },
      Modal: {
        borderRadiusLG: 14,
        titleFontSize: 17,
        paddingContentHorizontalLG: 20,
        paddingMD: 18,
      },
      Select: {
        controlHeight: 32,
        controlHeightSM: 26,
      },
      Dropdown: {
        borderRadiusLG: 10,
        paddingBlock: 6,
      },
      Badge: {
        textFontSizeSM: 10,
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
