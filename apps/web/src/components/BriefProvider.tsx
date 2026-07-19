import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { BriefModal } from "./BriefModal";

type BriefContextValue = {
  openBrief: () => void;
};

const BriefContext = createContext<BriefContextValue | null>(null);

export function BriefProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openBrief = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ openBrief }), [openBrief]);

  return (
    <BriefContext.Provider value={value}>
      {children}
      <BriefModal open={open} onClose={onClose} />
    </BriefContext.Provider>
  );
}

export function useBrief() {
  const ctx = useContext(BriefContext);
  if (!ctx) throw new Error("useBrief must be used within BriefProvider");
  return ctx;
}
