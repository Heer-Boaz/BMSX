import { runGate } from '../../../machine/ts/common/taskgate';
import { machineManager } from '../../../machine/ts/core/machine_manager';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	beginMachineHostFrame,
	beginMachineHostUpdate,
	completeMachineHostUpdate,
	executeMachineHostMenuAction,
	MachineHostFrameAction,
	prepareMachineHostPresentation,
	presentMachineHostPresentation,
} from '../../../runtime/host_frame';
import { HostOverlayMenu } from '../../../runtime/host_overlay_menu';
import { RenderPresentationState } from '../../../runtime/presentation_state';
import type { CpuProfilerSession } from '../cpu_profiler';

function runCpuProfileHostFrame(
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runtime: Runtime,
	session: CpuProfilerSession,
	currentTime: number,
): void {
	const manager = machineManager;
	if (!manager.running) {
		return;
	}
	const hostDeltaMs = beginMachineHostFrame(runtime, currentTime);
	const hostMenuInput = hostOverlayMenu.tickInput();
	if (executeMachineHostMenuAction(hostMenuInput, screen, runtime)) {
		return;
	}
	let action = prepareMachineHostPresentation(
		screen,
		hostOverlayMenu,
		runtime,
		runGate.ready,
		hostMenuInput,
	);
	if (action === MachineHostFrameAction.Execute) {
		const previousTickSequence = beginMachineHostUpdate(runtime);
		let stepDeltaMs = hostDeltaMs;
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
			if (!runtime.machine.gxGpu.backendReadbackPending()) {
				break;
			}
			manager.videoPresenter.backend.executeGxGpuReadback(runtime.machine.gxGpu);
		}
		completeMachineHostUpdate(screen, runtime, previousTickSequence);
		action = MachineHostFrameAction.PresentPending;
	}
	presentMachineHostPresentation(action, screen, runtime, hostDeltaMs);
	manager.flushSystemOutput(runtime);
}

export function startCpuProfileHostFrames(
	runtime: Runtime,
	session: CpuProfilerSession,
): void {
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu();
	machineManager.start();
	machineManager.platform.frames.start((currentTime) => {
		runCpuProfileHostFrame(
			presentation,
			hostOverlayMenu,
			runtime,
			session,
			currentTime,
		);
	});
}
