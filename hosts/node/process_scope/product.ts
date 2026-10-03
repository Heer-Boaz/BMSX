import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Build publication shared by the product builder and the Node runtime. Not served to browsers. */
export const PROCESS_SCOPE_SUPPORTED = process.platform === 'linux' || process.platform === 'win32';
export const PROCESS_SCOPE_PRODUCT_DIRECTORY = fileURLToPath(new URL('../../../.bmsx/host-process-scope/', import.meta.url));
export const PROCESS_SCOPE_PRODUCT_FILE = join(PROCESS_SCOPE_PRODUCT_DIRECTORY, `${process.platform}-${process.arch}.json`);
export type ProcessScopeProduct = { fingerprint: string; executable: string };
