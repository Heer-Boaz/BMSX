import { RenderPassLibrary } from '../../backend/pass_library';

// WebGPU stub: registers the Skybox pass for WebGPU builds.
export function registerSkyboxPass_WebGPU(library: RenderPassLibrary): void {
	library.register({
		id: 'skybox',
		name: 'Skybox (WebGPU)',
		writesDepth: true,
		stateOnly: true,
		shouldExecute: () => false,
		exec: () => { /* no-op */ },
		prepare: () => { /* set skybox state here when implemented */ },
	});
}
