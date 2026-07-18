import { Badge, Button, Flex, Segmented } from "antd";
import type { ReactNode } from "react";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  badge?: ReactNode;
}

interface Props<T extends string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Extra controls on the right of the tab bar */
  trailing?: ReactNode;
  className?: string;
  size?: "sm" | "md";
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
  className = "",
  size = "sm",
}: Props<T>) {
  return (
    <Flex
      className={`seg-tabs ${className}`.trim()}
      align="center"
      justify="space-between"
      gap={8}
      onClick={(e) => e.stopPropagation()}
    >
      <Segmented
        size={size === "md" ? "middle" : "small"}
        value={value}
        onChange={(next) => onChange(next as T)}
        options={tabs.map((tab) => ({
          value: tab.id,
          label: (
            <span className="seg-tab-label">
              <span>{tab.label}</span>
              {typeof tab.count === "number" && (
                <Badge count={tab.count} showZero={false} overflowCount={99} size="small" />
              )}
              {tab.badge}
            </span>
          ),
        }))}
      />
      {trailing && <div className="seg-tabs-trailing">{trailing}</div>}
    </Flex>
  );
}

/** Compact expand control used beside SegmentedTabs */
export function TabExpandButton({ onClick, label = "Expand" }: { onClick: () => void; label?: string }) {
  return (
    <Button type="text" size="small" className="tab-expand-btn" onClick={onClick}>
      {label}
    </Button>
  );
}
