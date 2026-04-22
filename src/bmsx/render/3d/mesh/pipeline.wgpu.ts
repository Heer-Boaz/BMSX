import { RenderPassLibrary } from '../backend/pass_library';
import type { RenderPassDef } from '../backend/interfaces';

// WebGPU stub: registers the Mesh Batch pass for WebGPU builds.
// Replace with WGSL, vertex/index buffer setup and proper execution.
export function registerMeshBatchPass_WebGPU(library: RenderPassLibrary): void {
	const pass: RenderPassDef<unknown> = {
		id: 'meshbatch',
		name: 'Meshes (WebGPU)',
		writesDepth: true,
		stateOnly: true,
		shouldExecute: () => false, // Skip until implemented
		exec: () => { /* no-op */ },
		prepare: () => { /* set mesh state here when implemented */ },
	};
	library.register(pass);
}
