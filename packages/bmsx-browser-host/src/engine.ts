import { constructPlatformFromViewHostHandle } from './platform';
import { startCart } from 'bmsx/machine/program/start_cart';

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
