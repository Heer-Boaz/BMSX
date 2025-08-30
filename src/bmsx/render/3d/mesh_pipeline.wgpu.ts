import { PipelineRegistry } from '../backend/pipeline_registry';

// WebGPU stub: registers the Mesh Batch pass for WebGPU builds.
// Replace with WGSL, vertex/index buffer setup and proper execution.
export function registerMeshBatchPass_WebGPU(registry: PipelineRegistry): void {
    registry.register({
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

