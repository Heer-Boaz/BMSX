import { HostPauseReason } from '../../hosts/common/execution_control';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import {
	beginHostFrame,
	executeHostUpdate,
	HostFrameAction,
	HostFrameRunResult,
	type HostFramePresentation,
	type HostFrameSession,
	prepareHostUpdate,
	presentHostPresentation,
} from '../../hosts/common/host_frame';
import { HostMenuExecution, HostMenuInput, type HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { Input } from '../../hosts/common/input/manager';
import type { LogOutput } from '../../hosts/common/log';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../hosts/common/system_output_log';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import { performReboot } from '../commands/actions';
import { activateEditor } from './overlay_modes';
import { handleSupervisorFault } from './runtime_errors';
import { presentRuntimeDebuggerStop } from './contrib/debugger/controller';
import * as workbenchMode from './mode';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import {
	didExecuteRuntimeDebuggerPlan,
	didFaultRuntimeDebuggerPlan,
	willExecuteRuntimeDebuggerPlan,
	runtimeDebuggerExecutionRequested,
} from '../runtime/debugger_state';

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
		case HostMenuInput.RebootCart: {
			const operation = performReboot(ide.boots, ide.editor, ide.execution, ide.overlayRenderer, audioOutput, ide.logOutput);
			void operation.completion.then(result => {
				if (result.status === 'reset' && ide.boots.latestOperation === operation) screen.reset(presenter, runtime);
			}).catch(error => workbenchMode.surfaceHostFrameError(ide, ide.logOutput, runtime, error));
			return true;
		}
		case HostMenuInput.ExitGame:
			return true;
	}
}

function runWorkbenchOverlay(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
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
	runWorkbenchOverlay(ide, screen, hostDeltaMs);
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
	let systemOutputDrained = false;
	try {
		hostDeltaMs = beginHostFrame(
			session,
			input,
			logOutput,
			currentTime,
		);
		const hostMenuInput = hostOverlayMenu.tickInput();
		const menuExecution = hostOverlayMenu.executionMode;
		const menuPaused = menuExecution === HostMenuExecution.Paused;
		audioOutput.muteMenu(menuPaused || (menuExecution === HostMenuExecution.Rewind && !session.rewind.playing));
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
			systemOutput.flush(runtime, logOutput, ide.terminal.receiveOutput);
			return HostFrameRunResult.Continue;
		}
		if (hostMenuInput !== HostMenuInput.Active) {
			workbenchMode.tickIdeInput(ide, input);
		}

		ide.scenarioRuns.advance();
		screen.clearPresentation();
		if (!menuPaused) {
			// Seek and recorded-frame stepping can execute inside service(), before the ordinary update.
			if (session.rewind.seeking || session.rewind.playing) ide.luaTooling.suspendedGuest.invalidate();
			session.rewind.service(!ide.debugger.plans.mutationActive);
			if (session.rewind.playing && !session.execution.executionBlocked() && !ide.fault.hostFrameFailed) {
				session.rewind.runPlayback(session.execution.consumeElapsedTime(hostDeltaMs));
				session.syncMachineOutput(runtime, input, audioOutput);
			}
		}
		if (ide.debugger.stopPresentationPending) {
			session.execution.finishFrameStep();
			activateEditor(ide.editor, ide.sources, runtime, audioOutput);
			void presentRuntimeDebuggerStop(ide.editor, ide.debugger)
				.catch(error => workbenchMode.surfaceHostFrameError(ide, logOutput, runtime, error));
		}
		const runtimeReady = ide.runtimeTasks.ready && !ide.fault.hostFrameFailed && !session.rewind.active
			&& !ide.debugger.plans.controlSuspended;
		session.execution.setPauseReason(HostPauseReason.Workbench, ide.editor.executionSuspended);
		audioOutput.muteUi(ide.editor.executionSuspended);
		let action: HostFrameAction;
		const machineWillAdvance = (
			hostMenuInput === HostMenuInput.Inactive
			&& !session.execution.executionBlocked(runtimeDebuggerExecutionRequested(ide.debugger))
			&& runtimeReady
		);
		action = prepareHostUpdate(
			session,
			runtime,
			runtimeReady,
			hostMenuInput,
			runtimeDebuggerExecutionRequested(ide.debugger),
		);
		if (action === HostFrameAction.Execute) {
			if (ide.debugger.plans.controlActive) willExecuteRuntimeDebuggerPlan(ide.debugger);
			ide.luaTooling.suspendedGuest.invalidate();
			executeHostUpdate(session, runtime, presenter, input, audioOutput, screen, hostDeltaMs);
			systemOutput.flush(runtime, logOutput, ide.terminal.receiveOutput);
			systemOutputDrained = true;
			const supervisorFaultSequence = runtime.machine.memory.readMappedU32LE(
				IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
			);
			if (supervisorFaultSequence !== ide.fault.supervisorFaultSequence) {
				session.execution.finishFrameStep();
				ide.fault.supervisorFaultSequence = supervisorFaultSequence;
				ide.debugger.plans.faultCompletionBatches(supervisorFaultSequence);
				handleSupervisorFault(
					logOutput,
					ide.fault,
					ide.sources,
					runtime,
					ide.luaTooling.suspendedGuest,
				);
				if (ide.debugger.plans.controlActive) {
					didFaultRuntimeDebuggerPlan(ide.debugger);
				}
			} else {
				if (ide.debugger.plans.controlActive) didExecuteRuntimeDebuggerPlan(ide.debugger);
				ide.debugger.plans.pruneCompletedCompletionBatches();
			}
			if (ide.debugger.stopPresentationPending) {
				session.execution.finishFrameStep();
				activateEditor(
					ide.editor,
					ide.sources,
					runtime,
					audioOutput,
				);
				void presentRuntimeDebuggerStop(ide.editor, ide.debugger)
					.catch(error => workbenchMode.surfaceHostFrameError(ide, logOutput, runtime, error));
			}
			action = HostFrameAction.PresentPending;
		}
		ide.microtasks.flush();
		if (machineWillAdvance) {
			syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
		}
		if (hostMenuInput !== HostMenuInput.Active && ide.overlayRenderer.active) {
			runWorkbenchOverlay(ide, screen, hostDeltaMs);
			ide.microtasks.flush();
			action = HostFrameAction.PresentPending;
		}
		if (hostOverlayMenu.queueFrameOverlayCommands(session.hostFps)
			|| session.rewind.active || !ide.runtimeTasks.ready) screen.requestHeldPresentation();
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

		if (!menuPaused && runtime.history.checkpointPending && ide.runtimeTasks.ready) {
			session.rewind.service(!ide.debugger.plans.mutationActive);
		}
	} catch (error) {
		session.execution.finishFrameStep();
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
	ide.frameNavigation.afterHostFrame();
	if (!systemOutputDrained) {
		systemOutput.flush(runtime, logOutput, ide.terminal.receiveOutput);
	}
	ide.terminal.afterHostFrame();
	return HostFrameRunResult.Continue;
}
