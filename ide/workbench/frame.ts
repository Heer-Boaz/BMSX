import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { beginHostFrame, HostFrameAction, HostFrameRunResult, type HostFramePresentation, prepareHostUpdate, presentHostPresentation } from '../../hosts/common/host_frame';
import type { HostFrameSession } from '../../hosts/common/frame_session';
import { HostMenuInput } from '../../hosts/common/host_overlay_menu';
import type { Input } from '../../hosts/common/input/manager';
import { executeHostUpdate } from '../../hosts/common/machine_step';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../hosts/common/system_output_log';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { didExecuteRuntimeDebuggerPlan, didFaultRuntimeDebuggerPlan, runtimeDebuggerExecutionRequested,
	willExecuteRuntimeDebuggerPlan } from '../runtime/debugger_state';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import { runBackgroundTasks } from '../common/background_tasks';
import { handleSupervisorFault } from './runtime_errors';
import type { StudioWorkbench } from './workbench';

/** Physical work only. Both hosts run this phase between input policy and presentation. */
export function advanceStudioFrame(
	session: HostFrameSession, runtime: Runtime, presenter: VideoPresenter, audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog, workbench: StudioWorkbench, screen: RenderPresentationState, hostDeltaMs: number,
	hostMenuInput = HostMenuInput.Inactive, menuPaused = false,
): HostFramePresentation {
	const logOutput = workbench.logOutput;
	workbench.frameNavigation.beforeHostFrame();
	workbench.debuggerExecution.beforeHostFrame();
	workbench.scenarioRuns.advance();
	screen.beginHostFrame();
	const collectHistory = !workbench.debugger.plans.mutationActive;
	workbench.frame.collectingHistory = collectHistory;
	if (!menuPaused) {
		// Seek and recorded-frame stepping can execute inside service(), before the ordinary update.
		if (session.rewind.seeking || session.rewind.playing) workbench.guest.invalidate();
		session.rewind.service(collectHistory);
		if (session.rewind.playing && !session.execution.executionBlocked() && workbench.fault.hostFrameFailure === undefined) {
			session.rewind.runPlayback(session.execution.consumeElapsedTime(hostDeltaMs));
			session.syncMachineOutput(runtime, audioOutput);
		}
	}
	if (workbench.debugger.stopPresentationPending) workbench.publishDebuggerStop();
	const runtimeReady = workbench.runtimeTasks.ready && workbench.fault.hostFrameFailure === undefined && !session.rewind.active
		&& !workbench.debugger.plans.controlSuspended && workbench.debugger.source.stop === undefined;
	let action: HostFrameAction;
	const machineWillAdvance = (
		hostMenuInput === HostMenuInput.Inactive
		&& !session.execution.executionBlocked(runtimeDebuggerExecutionRequested(workbench.debugger))
		&& runtimeReady
	);
	action = prepareHostUpdate(
		session,
		runtime,
		runtimeReady,
		hostMenuInput,
		runtimeDebuggerExecutionRequested(workbench.debugger),
	);
	if (action === HostFrameAction.Execute) {
		if (workbench.debugger.plans.controlActive) willExecuteRuntimeDebuggerPlan(workbench.debugger);
		workbench.guest.invalidate();
		executeHostUpdate(session, runtime, presenter, audioOutput, screen, hostDeltaMs);
		systemOutput.flush(runtime, logOutput, workbench.luaEvaluation.receiveOutput);
		workbench.frame.outputDrained = true;
		const supervisorFaultSequence = runtime.machine.memory.readMappedU32LE(
			IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
		);
		if (supervisorFaultSequence !== workbench.fault.supervisorFaultSequence) {
			session.execution.finishFrameStep();
			workbench.fault.supervisorFaultSequence = supervisorFaultSequence;
			workbench.debugger.plans.faultCompletionBatches(supervisorFaultSequence);
			handleSupervisorFault(
				logOutput,
				workbench.fault,
				workbench.sources,
				runtime,
				workbench.guest,
			);
			if (workbench.debugger.plans.controlActive) {
				didFaultRuntimeDebuggerPlan(workbench.debugger);
			}
		} else {
			if (workbench.debugger.plans.controlActive) didExecuteRuntimeDebuggerPlan(workbench.debugger);
			workbench.debugger.plans.pruneCompletedCompletionBatches();
		}
		if (workbench.debugger.stopPresentationPending) workbench.publishDebuggerStop();
		action = HostFrameAction.PresentPending;
	}
	workbench.microtasks.flush();
	if (machineWillAdvance) {
		syncRuntimeSourceActivity(workbench.sources, runtime.machine.cpu.activeCartridgeSlot());
	}
	runBackgroundTasks(workbench.clock);
	return action;
}

/** A call/recovery checkpoint is admitted after presentation, before finite-operation receipts settle. */
export function finishStudioFrame(
	session: HostFrameSession, runtime: Runtime, input: Input, systemOutput: SystemOutputLog,
	workbench: StudioWorkbench, menuPaused = false, presented = true,
): void {
	if (presented && !menuPaused && workbench.runtimeTasks.ready && (runtime.history.checkpointPending
		|| workbench.frame.collectingHistory !== !workbench.debugger.plans.mutationActive)) {
		try { session.rewind.service(!workbench.debugger.plans.mutationActive); }
		catch (error) { session.execution.finishFrameStep(); workbench.failHostFrame(error); }
	}
	input.setFrameDurationMs(runtime.timing.frameDurationMs);
	workbench.frameNavigation.afterHostFrame();
	workbench.debuggerExecution.afterHostFrame();
	if (!workbench.frame.outputDrained) systemOutput.flush(runtime, workbench.logOutput, workbench.luaEvaluation.receiveOutput);
	workbench.luaEvaluation.afterHostFrame();
	workbench.actorExecution.afterHostFrame();
}

/** A viewless Studio host uses the same physical phases, with its own explicit input/presentation policy. */
export function runStudioHostFrame(
	session: HostFrameSession, runtime: Runtime, presenter: VideoPresenter, input: Input,
	audioOutput: HostAudioOutput, systemOutput: SystemOutputLog, workbench: StudioWorkbench,
	screen: RenderPresentationState, currentTime: number,
): HostFrameRunResult {
	workbench.frame.outputDrained = false;
	let presented = false;
	try {
		const hostDeltaMs = beginHostFrame(session, input, workbench.logOutput, currentTime);
		workbench.play.advance(hostDeltaMs, true);
		const play = workbench.play.current?.session;
		audioOutput.device.select(play?.ready === true ? play.audio : audioOutput);
		const action = advanceStudioFrame(session, runtime, presenter, audioOutput, systemOutput, workbench, screen, hostDeltaMs);
		if (session.rewind.active || !workbench.runtimeTasks.ready) screen.requestHeldPresentation();
		presentHostPresentation(session, runtime, presenter, audioOutput, action, screen, hostDeltaMs);
		presented = true;
	} catch (error) {
		session.execution.finishFrameStep();
		workbench.failHostFrame(error);
	}
	finishStudioFrame(session, runtime, input, systemOutput, workbench, false, presented);
	return HostFrameRunResult.Continue;
}
