import {
	machineManager,
	type MachineInitialization,
	type MachineInitializationOptions,
} from '../machine/ts/core/machine_manager';
import { runGate } from '../machine/ts/common/taskgate';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import { HostOverlayMenu } from './host_overlay_menu';
import { runMachineHostFrame } from './host_frame';
import { RenderPresentationState } from './presentation_state';

export async function prepareMachineRuntime(
	options: MachineInitializationOptions,
): Promise<MachineInitialization> {
	const initialized = await machineManager.initialize(options);
	const runtime = initialized.runtime;
	runtime.resetForSystemBoot();
	runtime.boot();
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
	return initialized;
}

export function startMachineHostFrames(runtime: Runtime): void {
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu();
	machineManager.start();
	machineManager.platform.frames.start((currentTime) => {
		runMachineHostFrame(
			presentation,
			hostOverlayMenu,
			runtime,
			currentTime,
			runGate.ready,
		);
	});
}
