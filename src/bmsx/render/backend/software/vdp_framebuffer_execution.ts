import type { HeadlessGPUBackend } from '../../headless/backend';
import type { VDP } from '../../../machine/devices/vdp/vdp';

export function drainReadyVdpFrameBufferExecutionForSoftware(backend: HeadlessGPUBackend, vdp: VDP): void {
	const commands = vdp.readyFrameBufferCommands;
	if (commands === null) {
		return;
	}
	const frameBufferSlot = vdp.frameBufferExecutionTarget();
	backend.executeVdpFrameBufferCommands(vdp, commands, frameBufferSlot.cpuReadback);
	vdp.completeReadyFrameBufferExecution(frameBufferSlot);
}
