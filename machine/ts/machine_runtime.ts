import { consoleCore } from './core/console';
import type { ConsoleCore } from './core/console';

type BmsxMachineGlobal = {
	consoleCore: ConsoleCore;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.consoleCore = consoleCore;
globalTarget.bmsx = namespace;
