import { constructPlatformFromViewHostHandle } from '../../../bmsx_hostplatform/platform';
import { startCart } from './start_cart';

type BmsxGlobal = {
	constructPlatformFromViewHostHandle: typeof constructPlatformFromViewHostHandle;
	startCart: typeof startCart;
};

declare global {
	// eslint-disable-next-line no-var
	var bmsx: BmsxGlobal;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: BmsxGlobal };

globalTarget.bmsx = { constructPlatformFromViewHostHandle, startCart };
