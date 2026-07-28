import { runGate } from '../../../machine/ts/common/taskgate';
import { InstructionStepResult } from '../../../machine/ts/machine/runtime/frame/state';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import type { MachineHost } from '../../../runtime/machine_runtime';
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
	host: MachineHost,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	runtime: Runtime,
	session: CpuProfilerSession,
	currentTime: number,
): void {
	if (!host.running) {
		return;
	}
	const hostDeltaMs = beginMachineHostFrame(host, currentTime);
	const hostMenuInput = hostOverlayMenu.tickInput();
	if (executeMachineHostMenuAction(hostMenuInput, screen, host)) {
		return;
	}
	let action = prepareMachineHostPresentation(
		host,
		screen,
		hostOverlayMenu,
		runGate.ready,
		hostMenuInput,
	);
	if (action === MachineHostFrameAction.Execute) {
		const previousTickSequence = beginMachineHostUpdate(host);
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
			host.presenter.backend.executeGxGpuReadback(runtime.machine.gxGpu);
		}
		completeMachineHostUpdate(host, screen, previousTickSequence);
		action = MachineHostFrameAction.PresentPending;
	}
	presentMachineHostPresentation(host, action, screen, hostDeltaMs);
	host.flushSystemOutput();
}

export function startCpuProfileHostFrames(
	host: MachineHost,
	session: CpuProfilerSession,
): void {
	const runtime = host.runtime;
	const presentation = new RenderPresentationState();
	const hostOverlayMenu = new HostOverlayMenu(host.presenter, runtime, host.input);
	host.start();
	host.platform.frames.start((currentTime) => {
		runCpuProfileHostFrame(
			host,
			presentation,
			hostOverlayMenu,
			runtime,
			session,
			currentTime,
		);
	});
}
