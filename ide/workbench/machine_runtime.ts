import {
	machineManager,
	type MachineInitializationOptions,
} from '../../machine/ts/core/machine_manager';
import { runGate } from '../../machine/ts/common/taskgate';
import { HostOverlayMenu } from '../../runtime/host_overlay_menu';
import { RenderPresentationState } from '../../runtime/presentation_state';
import { createRuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { loadRomToolingMedia } from '../../machine/ts/rompack/tooling/media';
import { startPreparedRuntime } from './blua32_boot';
import { runWorkbenchHostFrame } from './host_frame';
import * as workbenchMode from './mode';
import { initializeMachineHost } from '../../runtime/machine_runtime';
import type { Platform } from '../../machine/ts/platform/platform';

export async function prepareWorkbenchRuntime(
	options: MachineInitializationOptions,
): Promise<RuntimeIdeState> {
	const media = await loadRomToolingMedia(
		options.systemRom,
		options.cartridgeSlots,
	);
	const host = await initializeMachineHost(options);
	const runtime = host.runtime;
	const sources = createRuntimeSourceState(
		media.system,
		media.cartridgeSlots,
	);
	const viewport = host.presenter.viewportSize;
	const ide = await workbenchMode.initializeIdeFeatures(
		runtime,
		host.presenter,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	await startPreparedRuntime(ide, runtime);
	machineManager.flushSystemOutput(runtime);
	machineManager.bootstrapStartupAudio();
	return ide;
}

export function startWorkbenchHostFrames(platform: Platform, ide: RuntimeIdeState): void {
	const runtime = ide.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(ide.presenter);
	machineManager.start();
	platform.frames.start((currentTime) => {
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
