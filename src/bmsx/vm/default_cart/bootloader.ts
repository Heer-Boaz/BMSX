import type { BootArgs } from '../../rompack/rompack';
import { startCart } from '../start_cart';

declare global {
	// eslint-disable-next-line no-var
	var h406A: (args: BootArgs) => Promise<void>;
}

globalThis.h406A = startCart;
