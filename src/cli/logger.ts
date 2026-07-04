import type { PlutoManagerLogger } from "../plutoManager.ts";

export const consoleLogger: PlutoManagerLogger = {
  showWarningMessage: async (msg: string) => {
    console.warn(`[warn] ${msg}`);
    return undefined;
  },
  showInfoMessage: async (msg: string) => {
    console.log(`[info] ${msg}`);
    return undefined;
  },
  showErrorMessage: async (msg: string) => {
    console.error(`[error] ${msg}`);
    return undefined;
  },
};
