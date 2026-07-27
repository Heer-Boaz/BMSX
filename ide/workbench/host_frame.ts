import { machineManager } from '../../machine/ts/core/machine_manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HostMenuInput, type HostOverlayMenu } from '../../runtime/host_overlay_menu';
import {
	beginMachineHostFrame,
	MachineHostPresentation,
	prepareMachineHostPresentation,
	presentMachineHostPresentation,
} from '../../runtime/host_frame';
import type { RenderPresentationState } from '../../runtime/presentation_state';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { rebootPreparedRuntime } from './blua32_boot';
import * as workbenchMode from './mode';

function executeWorkbenchHostMenuAction(
	ide: RuntimeIdeState,
	input: HostMenuInput,
	runtime: Runtime,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			void rebootPreparedRuntime(
				ide.sources,
				ide.fault,
				ide.luaTooling,
				ide.editor,
				ide.luaGate,
				ide.overlayRenderer,
				runtime,
			);
			return true;
		case HostMenuInput.ExitGame:
			machineManager.platform.requestShutdown();
			return true;
	}
}

function runWorkbenchOverlay(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	runtime: Runtime,
): void {
	screen.clearPresentation();
	if (runtime.frameLoop.frameActive) {
		runtime.frameLoop.abandonFrameState();
	}
	runtime.frameScheduler.clearQueuedTime();
	workbenchMode.tickIDE(ide, runtime);
	screen.requestHeldPresentation();
}

function presentWorkbenchFrame(
	ide: RuntimeIdeState,
	presentation: MachineHostPresentation,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	if (
		presentation === MachineHostPresentation.Pending
		&& !screen.pending
	) {
		return;
	}
	if (presentation === MachineHostPresentation.Pending) {
		workbenchMode.tickIDEDraw(ide, runtime);
	}
	presentMachineHostPresentation(
		presentation,
		screen,
		runtime,
		hostDeltaMs,
	);
}

function presentWorkbenchError(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	runtime: Runtime,
	hostDeltaMs: number,
): void {
	if (!ide.overlayRenderer.active) {
		return;
	}
	runWorkbenchOverlay(ide, screen, runtime);
	presentWorkbenchFrame(
		ide,
		MachineHostPresentation.Pending,
		screen,
		runtime,
		hostDeltaMs,
	);
}

export function runWorkbenchHostFrame(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runtime: Runtime,
	currentTime: number,
	runReady: boolean,
): void {
	const manager = machineManager;
	if (!manager.running) {
		return;
	}
	let hostDeltaMs = 0;
	try {
		hostDeltaMs = beginMachineHostFrame(runtime, currentTime);
		workbenchMode.tickIdeInput(ide);
		const hostMenuInput = hostOverlayMenu.tickInput();
		if (executeWorkbenchHostMenuAction(ide, hostMenuInput, runtime)) {
			runtime.frameScheduler.clearQueuedTime();
			manager.flushSystemOutput(runtime);
			return;
		}

		let presentation: MachineHostPresentation;
		if (
			hostMenuInput !== HostMenuInput.Active
			&& ide.overlayRenderer.active
		) {
			hostOverlayMenu.queueFrameOverlayCommands();
			runWorkbenchOverlay(ide, screen, runtime);
			manager.platform.microtasks.flush();
			presentation = MachineHostPresentation.Pending;
		} else {
			const machineWillAdvance = (
				hostMenuInput === HostMenuInput.Inactive
				&& !manager.paused
				&& runReady
			);
			presentation = prepareMachineHostPresentation(
				screen,
				hostOverlayMenu,
				runtime,
				hostDeltaMs,
				runReady,
				hostMenuInput,
			);
			if (machineWillAdvance) {
				syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
			}
		}
		presentWorkbenchFrame(ide, presentation, screen, runtime, hostDeltaMs);
	} catch (error) {
		workbenchMode.surfaceHostFrameError(ide, runtime, error);
		presentWorkbenchError(ide, screen, runtime, hostDeltaMs);
	}
	manager.flushSystemOutput(runtime);
}
