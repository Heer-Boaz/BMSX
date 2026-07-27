import {
	machineManager,
	type MachineInitializationOptions,
} from '../machine/ts/core/machine_manager';
import { runGate } from '../machine/ts/common/taskgate';
import { createRuntimeSourceState } from '../ide/runtime/sources';
import type { RuntimeIdeState } from '../ide/runtime/state';
import * as workbenchMode from '../ide/workbench/mode';
import { startPreparedRuntime } from '../ide/workbench/blua32_boot';
import { HostOverlayMenu } from './host_overlay_menu';
import { runMachineHostFrame } from './host_frame';
import { RenderPresentationState } from './presentation_state';

export async function prepareMachineRuntime(
	options: MachineInitializationOptions,
): Promise<RuntimeIdeState> {
	const initialized = await machineManager.initialize(options);
	const runtime = initialized.runtime;
	const sources = createRuntimeSourceState(
		initialized.systemLayer,
		initialized.cartridgeLayers,
	);
	const viewport = machineManager.view.viewportSize;
	const ide = await workbenchMode.initializeIdeFeatures(
		runtime,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	await startPreparedRuntime(ide, runtime);
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
	return ide;
}

export function startMachineHostFrames(ide: RuntimeIdeState): void {
	const runtime = machineManager.runtime;
	const presentation = new RenderPresentationState(ide);
	const hostOverlayMenu = new HostOverlayMenu(ide);
	machineManager.start();
	machineManager.platform.frames.start((currentTime) => {
		runMachineHostFrame(
			ide,
			presentation,
			hostOverlayMenu,
			runtime,
			currentTime,
			runGate.ready,
		);
	});
}
