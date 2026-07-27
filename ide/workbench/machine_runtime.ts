import {
	machineManager,
	type MachineInitializationOptions,
} from '../../machine/ts/core/machine_manager';
import { runGate } from '../../machine/ts/common/taskgate';
import { HostOverlayMenu } from '../../runtime/host_overlay_menu';
import { RenderPresentationState } from '../../runtime/presentation_state';
import { createRuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { startPreparedRuntime } from './blua32_boot';
import { runWorkbenchHostFrame } from './host_frame';
import * as workbenchMode from './mode';

export async function prepareWorkbenchRuntime(
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

export function startWorkbenchHostFrames(ide: RuntimeIdeState): void {
	const runtime = machineManager.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu();
	machineManager.start();
	machineManager.platform.frames.start((currentTime) => {
		runWorkbenchHostFrame(
			ide,
			presentation,
			hostOverlayMenu,
			runtime,
			currentTime,
			runGate.ready,
		);
	});
}
