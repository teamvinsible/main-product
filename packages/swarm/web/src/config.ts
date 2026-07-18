import { createContext, useContext } from "react";
import type { Config } from "./types";

export const ConfigContext = createContext<Config>({
  controlMode: false,
  projectTypes: [],
  phaseAgents: {},
  allPhases: [],
});

export const useConfig = () => useContext(ConfigContext);
