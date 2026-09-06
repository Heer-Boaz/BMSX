import type { HostAudioOutput } from '../../hosts/common/audio_output';
import {
	advanceHostScheduledLogicalTick,
	beginHostFrame,
	executeHostUpdate,
	HostFrameAction,
	HostFrameRunResult,
	type HostFramePresentation,
	type HostFrameSession,
	prepareHostUpdate,
	presentHostPresentation,
	syncAfterRuntimeUpdate,
} from '../../hosts/common/host_frame';
import { HostMenuInput, type HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { Input } from '../../hosts/common/input/manager';
import type { LogOutput } from '../../hosts/common/log';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../hosts/common/system_output_log';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import { rebootPreparedRuntime } from './blua32_boot';
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
		case HostMenuInput.RebootCart:
			screen.clearPresentation();
			if (ide.scenarioRuns.active) {
				ide.scenarioRuns.cancel();
				return true;
			}
			ide.runtimeTasks.schedule(async () => {
				await rebootPreparedRuntime(
					ide.sources,
					ide.fault,
					ide.luaTooling,
					ide.debugger,
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
	let systemOutputDrained = false;
	let scenarioGuestFrame = false;
	try {
		hostDeltaMs = beginHostFrame(
			session,
			input,
			logOutput,
			currentTime,
		);
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
		if (hostMenuInput !== HostMenuInput.Active) {
			workbenchMode.tickIdeInput(ide, input);
		}

		screen.clearPresentation();
		session.rewind.service(!ide.scenarioRuns.active && !ide.debugger.plans.mutationActive);
		if (session.rewind.playing && !session.execution.executionBlocked() && !ide.fault.hostFrameFailed) {
			session.rewind.runPlayback(session.execution.consumeElapsedTime(hostDeltaMs));
			session.syncMachineOutput(runtime, input, audioOutput);
		}
		if (ide.debugger.stopPresentationPending) {
			activateEditor(ide.editor, ide.sources, ide.overlayRenderer, runtime, audioOutput);
			presentRuntimeDebuggerStop(ide.editor, ide.debugger);
		}
		const runtimeReady = ide.runtimeTasks.ready && !ide.fault.hostFrameFailed && !session.rewind.active;
		let action: HostFrameAction;
		if (
			hostMenuInput !== HostMenuInput.Active
			&& ide.overlayRenderer.active
		) {
			runWorkbenchOverlay(ide, screen, runtime, hostDeltaMs);
			ide.microtasks.flush();
			action = HostFrameAction.PresentPending;
		} else {
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
				const scenarioExecution = ide.scenarioRuns.execution;
				if (scenarioExecution.active) {
					scenarioGuestFrame = true;
					const previousTickSequence = runtime.frameScheduler.lastTickSequence;
					let scheduledDeltaMs = session.execution.consumeElapsedTime(hostDeltaMs);
					let machineAdvanced = false;
					while (scenarioExecution.active && scenarioExecution.prepareLogicalTick()) {
						const completed = advanceHostScheduledLogicalTick(
							runtime,
							presenter,
							scheduledDeltaMs,
						);
						machineAdvanced = true;
						scenarioExecution.didRunLogicalTick(completed);
						scheduledDeltaMs = 0;
						if (!completed) {
							break;
						}
					}
					if (machineAdvanced) {
						syncAfterRuntimeUpdate(
							session,
							runtime,
							input,
							audioOutput,
							screen,
							previousTickSequence,
						);
					}
				} else {
					if (ide.debugger.plans.controlActive) {
						willExecuteRuntimeDebuggerPlan(ide.debugger);
					}
					executeHostUpdate(
						session,
						runtime,
						presenter,
						input,
						audioOutput,
						screen,
						hostDeltaMs,
					);
				}
				systemOutput.flush(runtime, logOutput);
				systemOutputDrained = true;
				if (!scenarioGuestFrame) {
					const supervisorFaultSequence = runtime.machine.memory.readMappedU32LE(
						IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
					);
					if (supervisorFaultSequence !== ide.fault.supervisorFaultSequence) {
						if (ide.debugger.plans.controlActive) {
							didFaultRuntimeDebuggerPlan(ide.debugger);
						}
						ide.fault.supervisorFaultSequence = supervisorFaultSequence;
						handleSupervisorFault(
							logOutput,
							ide.fault,
							ide.sources,
							runtime,
							ide.luaTooling.suspendedGuest,
						);
					} else if (ide.debugger.plans.controlActive) {
						didExecuteRuntimeDebuggerPlan(ide.debugger);
					}
					ide.debugger.plans.pruneCompletedCompletionBatches();
					if (ide.debugger.stopPresentationPending) {
						activateEditor(
							ide.editor,
							ide.sources,
							ide.overlayRenderer,
							runtime,
							audioOutput,
						);
						presentRuntimeDebuggerStop(ide.editor, ide.debugger);
					}
				}
				action = HostFrameAction.PresentPending;
			}
			ide.microtasks.flush();
			if (machineWillAdvance) {
				syncRuntimeSourceActivity(ide.sources, runtime.machine.cpu.activeCartridgeSlot());
			}
		}
		const previousPresentation = presenter.presentationSequence;
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
		if (scenarioGuestFrame) {
			ide.scenarioRuns.finishHostFrame(
				presenter.presentationSequence,
				presenter.presentationSequence !== previousPresentation,
			);
		}
		if (runtime.history.checkpointPending && ide.runtimeTasks.ready) {
			session.rewind.service(!ide.scenarioRuns.active && !ide.debugger.plans.mutationActive);
		}
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
	if (!systemOutputDrained) {
		systemOutput.flush(runtime, logOutput);
	}
	return HostFrameRunResult.Continue;
}
