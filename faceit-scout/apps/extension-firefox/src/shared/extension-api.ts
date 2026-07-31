export const extensionApi: typeof chrome =
  (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
