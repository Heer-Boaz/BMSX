/** Host-owned file selection and transfer, independent of runtime resources and text working copies. */
export type ImportWorkspaceFiles = (directory: string, signal: AbortSignal) => Promise<readonly string[]>;
