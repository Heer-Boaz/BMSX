import type { BootArgs } from '../index';
import * as bmsxNamespace from '../index';
import { startCart } from './start_cart';

declare global {
	// eslint-disable-next-line no-var
	var bmsx: typeof import('../index');
	// eslint-disable-next-line no-var
	var h406A: (args: BootArgs) => Promise<void>;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: typeof import('../index') };
globalTarget.bmsx = bmsxNamespace;

globalThis.h406A = startCart;
