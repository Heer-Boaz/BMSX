import { startCart } from './machine/program/start_cart';

type BmsxMachineGlobal = {
	startCart: typeof startCart;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.startCart = startCart;
globalTarget.bmsx = namespace;
