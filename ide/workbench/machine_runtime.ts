import { runGate } from '../../machine/ts/common/taskgate';
import { HostOverlayMenu } from '../../runtime/host_overlay_menu';
import { RenderPresentationState } from '../../runtime/presentation_state';
import { createRuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { loadRomToolingMedia } from '../../machine/ts/rompack/tooling/media';
import { startPreparedRuntime } from './blua32_boot';
import { runWorkbenchHostFrame } from './host_frame';
import * as workbenchMode from './mode';
import {
	initializeMachineHost,
	type MachineHost,
	type MachineHostInitializationOptions,
} from '../../runtime/machine_runtime';

export async function prepareWorkbenchRuntime(
	options: MachineHostInitializationOptions,
	resourcePanelWidthRatio: number,
): Promise<readonly [MachineHost, RuntimeIdeState]> {
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
		host.input,
		host.audioOutput,
		host.platform.storage,
		host.platform.clock,
		host.platform.lifecycle,
		host.platform.clipboard,
		host.platform.microtasks,
		host.platform,
		resourcePanelWidthRatio,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	await startPreparedRuntime(ide, runtime, host.platform);
	host.flushSystemOutput();
	host.audioOutput.bootstrap();
	return [host, ide];
}

export function startWorkbenchHostFrames(host: MachineHost, ide: RuntimeIdeState): void {
	const runtime = host.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(host.presenter, runtime, host.input);
	host.start();
	host.platform.frames.start((currentTime) => {
		runWorkbenchHostFrame(
			host,
			ide,
			presentation,
			hostOverlayMenu,
			currentTime,
			runGate.ready,
		);
	});
}
