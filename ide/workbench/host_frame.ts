import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HostMenuInput, type HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import {
	beginMachineHostFrame,
	executeMachineHostUpdate,
	MachineHostFrameAction,
	type MachineHostPresentation,
	prepareMachineHostPresentation,
	presentMachineHostPresentation,
} from '../../hosts/common/host_frame';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { MachineHost } from '../../hosts/common/machine_runtime';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { rebootPreparedRuntime } from './blua32_boot';
import * as workbenchMode from './mode';

function executeWorkbenchHostMenuAction(
	host: MachineHost,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	input: HostMenuInput,
	runtime: Runtime,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			screen.clearPresentation();
			void rebootPreparedRuntime(
				ide.sources,
				ide.fault,
				ide.luaTooling,
				ide.editor,
				ide.luaGate,
				ide.overlayRenderer,
				runtime,
				host.input,
				host.audioOutput,
				host.platform.storage,
				host.platform,
			).then(() => {
				screen.reset(host.presenter, runtime);
			});
			return true;
		case HostMenuInput.ExitGame:
			host.platform.requestShutdown();
			return true;
	}
}

function runWorkbenchOverlay(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	screen.clearPresentation();
	runtime.frameScheduler.clearQueuedTime();
	workbenchMode.tickIDE(ide, hostDeltaMs / 1000);
	screen.requestHeldPresentation();
}

function presentWorkbenchFrame(
	host: MachineHost,
	ide: RuntimeIdeState,
	action: MachineHostPresentation,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	if (
		action === MachineHostFrameAction.PresentPending
		&& !screen.pending
	) {
		return;
	}
	if (action === MachineHostFrameAction.PresentPending) {
		workbenchMode.tickIDEDraw(ide, host.presenter);
	}
	presentMachineHostPresentation(
		host,
		action,
		screen,
		hostDeltaMs,
	);
}

function presentWorkbenchError(
	host: MachineHost,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	if (!ide.overlayRenderer.active) {
		return;
	}
	runWorkbenchOverlay(ide, screen, runtime, hostDeltaMs);
	presentWorkbenchFrame(
		host,
		ide,
		MachineHostFrameAction.PresentPending,
		screen,
		hostDeltaMs,
	);
}

export function runWorkbenchHostFrame(
	host: MachineHost,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	currentTime: number,
	runReady: boolean,
): void {
	const runtime = host.runtime;
	if (!host.running) {
		return;
	}
	let hostDeltaMs = 0;
	try {
		hostDeltaMs = beginMachineHostFrame(host, currentTime);
		workbenchMode.tickIdeInput(ide, host.input);
		const hostMenuInput = hostOverlayMenu.tickInput();
		if (executeWorkbenchHostMenuAction(host, ide, screen, hostMenuInput, runtime)) {
			runtime.frameScheduler.clearQueuedTime();
			host.flushSystemOutput();
			return;
		}

		const runtimeReady = runReady && !ide.fault.faultSnapshot;
		let action: MachineHostFrameAction;
		if (
			hostMenuInput !== HostMenuInput.Active
			&& ide.overlayRenderer.active
		) {
			hostOverlayMenu.queueFrameOverlayCommands(host.hostFps);
			runWorkbenchOverlay(ide, screen, runtime, hostDeltaMs);
			host.platform.microtasks.flush();
			action = MachineHostFrameAction.PresentPending;
		} else {
			const machineWillAdvance = (
				hostMenuInput === HostMenuInput.Inactive
				&& !host.paused
				&& runtimeReady
			);
			action = prepareMachineHostPresentation(
				host,
				screen,
				hostOverlayMenu,
				runtimeReady,
				hostMenuInput,
			);
			if (action === MachineHostFrameAction.Execute) {
				executeMachineHostUpdate(host, screen, hostDeltaMs);
				action = MachineHostFrameAction.PresentPending;
			}
			if (machineWillAdvance) {
				syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
			}
		}
		presentWorkbenchFrame(host, ide, action, screen, hostDeltaMs);
	} catch (error) {
		workbenchMode.surfaceHostFrameError(ide, host.platform, runtime, error);
		presentWorkbenchError(host, ide, screen, runtime, hostDeltaMs);
	}
	host.flushSystemOutput();
}
