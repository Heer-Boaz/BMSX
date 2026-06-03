import { constructPlatformFromViewHostHandle } from './platform';
import { ensureBrowserBackendFactory } from 'bmsx/render/backend/browser_factory';

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

ensureBrowserBackendFactory();
