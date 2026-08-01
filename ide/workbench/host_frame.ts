import type { HostAudioOutput } from '../../hosts/common/audio_output';
import {
	beginHostFrame,
	executeHostUpdate,
	HostFrameAction,
	HostFrameRunResult,
	type HostFramePresentation,
	type HostFrameSession,
	prepareHostPresentation,
	presentHostPresentation,
} from '../../hosts/common/host_frame';
import { HostMenuInput, type HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { Input } from '../../hosts/common/input/manager';
import type { LogOutput } from '../../hosts/common/log';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../hosts/common/system_output_log';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { rebootPreparedRuntime } from './blua32_boot';
import { handleSupervisorFault } from './runtime_errors';
import * as workbenchMode from './mode';

function executeWorkbenchHostMenuAction(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	input: HostMenuInput,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart:
			screen.clearPresentation();
			ide.runtimeTasks.schedule(async () => {
				await rebootPreparedRuntime(
					ide.sources,
					ide.fault,
					ide.luaTooling,
					ide.editor,
					ide.overlayRenderer,
					runtime,
					audioOutput,
					ide.storage,
				);
				screen.reset(presenter, runtime);
			}, (error) => {
				workbenchMode.surfaceHostFrameError(
					ide,
					ide.logOutput,
					runtime,
					error,
				);
			});
			return true;
		case HostMenuInput.ExitGame:
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
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	ide: RuntimeIdeState,
	action: HostFramePresentation,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	if (
		action === HostFrameAction.PresentPending
		&& !screen.pending
	) {
		return;
	}
	if (action === HostFrameAction.PresentPending) {
		workbenchMode.tickIDEDraw(ide, presenter);
	}
	presentHostPresentation(
		session,
		runtime,
		presenter,
		audioOutput,
		action,
		screen,
		hostDeltaMs,
	);
}

function presentWorkbenchError(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	if (!ide.overlayRenderer.active) {
		return;
	}
	runWorkbenchOverlay(ide, screen, runtime, hostDeltaMs);
	presentWorkbenchFrame(
		session,
		runtime,
		presenter,
		audioOutput,
		ide,
		HostFrameAction.PresentPending,
		screen,
		hostDeltaMs,
	);
}

export function runWorkbenchHostFrame(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	currentTime: number,
): HostFrameRunResult {
	let hostDeltaMs = 0;
	try {
		hostDeltaMs = beginHostFrame(
			session,
			input,
			audioOutput,
			logOutput,
			currentTime,
		);
		workbenchMode.tickIdeInput(ide, input);
		const hostMenuInput = hostOverlayMenu.tickInput();
		if (hostMenuInput === HostMenuInput.ExitGame) {
			return HostFrameRunResult.ExitRequested;
		}
		if (executeWorkbenchHostMenuAction(
			ide,
			screen,
			hostMenuInput,
			runtime,
			presenter,
			audioOutput,
		)) {
			runtime.frameScheduler.clearQueuedTime();
			systemOutput.flush(runtime, logOutput);
			return HostFrameRunResult.Continue;
		}

		const runtimeReady = ide.runtimeTasks.ready && !ide.fault.hostFrameFailed;
		let action: HostFrameAction;
		if (
			hostMenuInput !== HostMenuInput.Active
			&& ide.overlayRenderer.active
		) {
			hostOverlayMenu.queueFrameOverlayCommands(session.hostFps);
			runWorkbenchOverlay(ide, screen, runtime, hostDeltaMs);
			ide.microtasks.flush();
			action = HostFrameAction.PresentPending;
		} else {
			const machineWillAdvance = (
				hostMenuInput === HostMenuInput.Inactive
				&& !session.paused
				&& runtimeReady
			);
			action = prepareHostPresentation(
				session,
				runtime,
				screen,
				hostOverlayMenu,
				runtimeReady,
				hostMenuInput,
			);
			if (action === HostFrameAction.Execute) {
				executeHostUpdate(
					session,
					runtime,
					presenter,
					input,
					audioOutput,
					screen,
					hostDeltaMs,
				);
				const supervisorFaultSequence = runtime.machine.systemController.readSupervisorFaultSequence();
				if (supervisorFaultSequence !== ide.supervisorFaultSequence) {
					ide.supervisorFaultSequence = supervisorFaultSequence;
					handleSupervisorFault(
						logOutput,
						ide.fault,
						ide.sources,
						runtime,
						ide.luaTooling.suspendedGuest,
					);
				}
				action = HostFrameAction.PresentPending;
			}
			ide.microtasks.flush();
			if (machineWillAdvance) {
				syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
			}
		}
		presentWorkbenchFrame(
			session,
			runtime,
			presenter,
			audioOutput,
			ide,
			action,
			screen,
			hostDeltaMs,
		);
	} catch (error) {
		workbenchMode.surfaceHostFrameError(ide, logOutput, runtime, error);
		presentWorkbenchError(
			session,
			runtime,
			presenter,
			audioOutput,
			ide,
			screen,
			hostDeltaMs,
		);
	}
	systemOutput.flush(runtime, logOutput);
	return HostFrameRunResult.Continue;
}
