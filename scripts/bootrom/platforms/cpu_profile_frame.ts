import type { HostAudioOutput } from '../../../hosts/common/audio_output';
import {
	beginHostFrame,
	executeHostMenuAction,
	HostFrameAction,
	HostFrameRunResult,
	type HostFrameSession,
	prepareHostUpdate,
	presentHostPresentation,
	syncAfterRuntimeUpdate,
} from '../../../hosts/common/host_frame';
import { HostMenuInput, type HostOverlayMenu } from '../../../hosts/common/host_overlay_menu';
import type { Input } from '../../../hosts/common/input/manager';
import type { LogOutput } from '../../../hosts/common/log';
import type { RenderPresentationState } from '../../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../../hosts/common/system_output_log';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../../machine/ts/render/video_presenter';
import type { CpuProfilerSession } from '../cpu_profiler';

export function runCpuProfileHostFrame(
	frameSession: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	session: CpuProfilerSession,
	currentTime: number,
): HostFrameRunResult {
	const hostDeltaMs = beginHostFrame(
		frameSession,
		input,
		logOutput,
		currentTime,
	);
	const hostMenuInput = hostOverlayMenu.tickInput();
	if (hostMenuInput === HostMenuInput.ExitGame) {
		return HostFrameRunResult.ExitRequested;
	}
	if (executeHostMenuAction(
		hostMenuInput,
		frameSession,
		screen,
		runtime,
		presenter,
		input,
		audioOutput,
		systemOutput,
		logOutput,
	)) {
		return HostFrameRunResult.Continue;
	}
	screen.clearPresentation();
	let action = prepareHostUpdate(
		frameSession,
		runtime,
		frameSession.rewind.tasks.ready,
		hostMenuInput,
	);
	if (action === HostFrameAction.Execute) {
		const previousTickSequence = runtime.frameScheduler.lastTickSequence;
		let stepDeltaMs = frameSession.execution.consumeElapsedTime(hostDeltaMs);
		while (true) {
			const result = runtime.frameScheduler.stepInstruction(stepDeltaMs);
			stepDeltaMs = 0;
			if (result === InstructionStepResult.Executed) {
				session.recordInstruction(
					runtime.machine.cpu.readLastExecutionDomain(),
					runtime.machine.cpu.lastPc,
				);
				continue;
			}
			if (result === InstructionStepResult.Advanced) {
				continue;
			}
			const gxGpu = runtime.machine.gxGpu;
			if (!gxGpu.backendServicePending()) {
				break;
			}
			if (gxGpu.backendCommandDrainPending()) {
				presenter.backend.executeGxGpuCommandDrain(gxGpu);
			} else {
				presenter.backend.executeGxGpuReadback(gxGpu);
			}
		}
		syncAfterRuntimeUpdate(
			frameSession,
			runtime,
			input,
			audioOutput,
			screen,
			previousTickSequence,
		);
		action = HostFrameAction.PresentPending;
	}
	if (hostOverlayMenu.queueFrameOverlayCommands(frameSession.hostFps)) screen.requestHeldPresentation();
	presentHostPresentation(
		frameSession,
		runtime,
		presenter,
		audioOutput,
		action,
		screen,
		hostDeltaMs,
	);
	systemOutput.flush(runtime, logOutput);
	return HostFrameRunResult.Continue;
}
