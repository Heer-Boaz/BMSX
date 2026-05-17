import type { HeadlessGPUBackend } from '../../headless/backend';
import type { RenderPassLibrary } from '../pass/library';
import type { VdpFrameBufferExecutionPassState } from '../backend';
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

export function registerVdpFrameBufferExecutionPass_Software(registry: RenderPassLibrary): void {
	registry.register<VdpFrameBufferExecutionPassState>({
		id: 'vdp_framebuffer_execution',
		name: 'VDPFrameBufferExecution',
		stateOnly: true,
		graph: { skip: true },
		exec: (backend, _fbo, state) => {
			const vdp = state.runtime.machine.vdp;
			drainReadyVdpFrameBufferExecutionForSoftware(backend as HeadlessGPUBackend, vdp);
		},
	});
}
