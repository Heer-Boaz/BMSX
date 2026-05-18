import type { VdpFrameBufferExecutionPassState } from '../backend/backend';
import type { RenderPassLibrary } from '../backend/pass/library';

export function registerVdpFrameBufferExecutionPass(registry: RenderPassLibrary): void {
	registry.register<VdpFrameBufferExecutionPassState>({
		id: 'vdp_framebuffer_execution',
		name: 'VDP2DBlitExecution',
		stateOnly: true,
		graph: { skip: true },
		bootstrap: (backend) => {
			backend.bootstrapVdp2DBlit();
		},
		exec: (backend, _fbo, state) => {
			backend.executeVdp2DBlit(state);
		},
	});
}
