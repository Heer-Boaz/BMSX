import { RenderPassLibrary } from '../backend/renderpasslib';

// WebGPU stub: registers the Mesh Batch pass for WebGPU builds.
// Replace with WGSL, vertex/index buffer setup and proper execution.
export function registerMeshBatchPass_WebGPU(library: RenderPassLibrary): void {
    library.register({
        id: 'meshbatch',
        label: 'meshbatch',
        name: 'Meshes (WebGPU)',
        writesDepth: true,
        stateOnly: true,
        shouldExecute: () => false, // Skip until implemented
        exec: () => { /* no-op */ },
        prepare: () => { /* set mesh state here when implemented */ },
    });
}
