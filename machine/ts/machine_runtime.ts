import { machineManager } from './core/machine_manager';
import type { MachineManager } from './core/machine_manager';
import { headlessIdeHarness, type HeadlessIdeHarness } from './ide/testing/headless_harness';

type BmsxMachineGlobal = {
	machineManager: MachineManager;
	ide: HeadlessIdeHarness;
};

const globalTarget = globalThis as typeof globalThis & { bmsx?: Partial<BmsxMachineGlobal> };
const namespace = globalTarget.bmsx || {};
namespace.machineManager = machineManager;
namespace.ide = headlessIdeHarness;
globalTarget.bmsx = namespace;
