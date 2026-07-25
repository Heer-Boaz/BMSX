import { machineManager } from '../machine/ts/core/machine_manager';
import type { MachineManager } from '../machine/ts/core/machine_manager';
import { headlessIdeHarness, type HeadlessIdeHarness } from './testing/headless_harness';
import { bootManagedMachine } from './runtime/machine_boot';

type BmsxMachineGlobal = {
	machineManager: MachineManager;
	bootMachine: typeof bootManagedMachine;
	ide: HeadlessIdeHarness;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.machineManager = machineManager;
namespace.bootMachine = bootManagedMachine;
namespace.ide = headlessIdeHarness;
globalTarget.bmsx = namespace;
