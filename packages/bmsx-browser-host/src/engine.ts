import { constructPlatformFromViewHostHandle } from './platform';

type BmsxGlobal = {
	constructPlatformFromViewHostHandle: typeof constructPlatformFromViewHostHandle;
};

declare global {
	// eslint-disable-next-line no-var
	var bmsx: BmsxGlobal;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: BmsxGlobal };
const namespace = globalTarget.bmsx || {} as BmsxGlobal;

namespace.constructPlatformFromViewHostHandle = constructPlatformFromViewHostHandle;
globalTarget.bmsx = namespace;
