import { startCart } from './start_cart';

type BmsxGlobal = {
	startCart: typeof startCart;
};

declare global {
	// eslint-disable-next-line no-var
	var bmsx: BmsxGlobal;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: BmsxGlobal };
globalTarget.bmsx = { startCart };
