import { startCart } from './machine/program/start_cart';
import { ensureBrowserBackendFactory } from './render/backend/browser_factory';

type BmsxMachineGlobal = {
	startCart: typeof startCart;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.startCart = startCart;
globalTarget.bmsx = namespace;
ensureBrowserBackendFactory();
