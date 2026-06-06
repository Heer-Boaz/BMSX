import { machineManager } from './core/machine_manager';
import type { MachineManager } from './core/machine_manager';

type BmsxMachineGlobal = {
	machineManager: MachineManager;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.machineManager = machineManager;
globalTarget.bmsx = namespace;
