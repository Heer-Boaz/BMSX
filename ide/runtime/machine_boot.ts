import { runtimeWorkbenchState } from './workbench_state';
import {
	machineManager,
	type MachineBootOptions,
	type MachineLaunchOptions,
} from '../../machine/ts/core/machine_manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { rebootPreparedRuntime, startPreparedRuntime } from '../workbench/blua32_boot';
import { runMachineHostFrame } from './host_frame';
import { createRuntimeSourceState } from './sources';

export async function bootManagedMachine(options: MachineLaunchOptions): Promise<Runtime> {
	const bootOptions: MachineBootOptions = {
		...options,
		initializeRuntime: async (runtime, media) => {
			runtimeWorkbenchState.sources = createRuntimeSourceState(
				media.systemLayer,
				media.cartridgeLayers,
			);
			await startPreparedRuntime(runtime);
		},
		runHostFrame: runMachineHostFrame,
		rebootRuntime: rebootPreparedRuntime,
	};
	return machineManager.boot(bootOptions);
}
