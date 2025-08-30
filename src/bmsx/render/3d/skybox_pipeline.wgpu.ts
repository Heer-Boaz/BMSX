import { PipelineRegistry } from '../backend/pipeline_registry';

// WebGPU stub: registers the Skybox pass for WebGPU builds.
export function registerSkyboxPass_WebGPU(registry: PipelineRegistry): void {
    registry.register({
        id: 'skybox',
        label: 'skybox',
        name: 'Skybox (WebGPU)',
        writesDepth: true,
        stateOnly: true,
        shouldExecute: () => false,
        exec: () => { /* no-op */ },
        prepare: () => { /* set skybox state here when implemented */ },
    });
}

