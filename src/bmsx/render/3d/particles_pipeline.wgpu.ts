import { RenderPassLibrary } from '../backend/renderpasslib';

// WebGPU stub: registers the Particles pass for WebGPU builds.
export function registerParticlesPass_WebGPU(library: RenderPassLibrary): void {
	library.register({
		id: 'particles',
		name: 'Particles (WebGPU)',
		writesDepth: true,
		stateOnly: true,
		shouldExecute: () => false,
		exec: () => { /* no-op */ },
		prepare: () => { /* set particle state here when implemented */ },
	});
}
