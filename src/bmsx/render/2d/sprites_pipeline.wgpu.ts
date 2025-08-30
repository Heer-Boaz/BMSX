import { PipelineRegistry } from '../backend/pipeline_registry';

// WebGPU stub: registers the Sprites pass for WebGPU builds.
// This is a placeholder. Replace with real WGSL shaders and GPUBackend calls.
export function registerSpritesPass_WebGPU(registry: PipelineRegistry): void {
    registry.register({
        id: 'sprites',
        label: 'sprites',
        name: 'Sprites2D (WebGPU)',
        stateOnly: true,
        shouldExecute: () => false, // Skip until implemented
        exec: () => { /* no-op */ },
        prepare: () => { /* set sprites state here when implemented */ },
    });
}

