import { PipelineRegistry } from '../backend/pipeline_registry';

// WebGPU stub: registers the CRT/present pass for WebGPU builds.
export function registerCRT_WebGPU(registry: PipelineRegistry): void {
    registry.register({
        id: 'crt',
        label: 'crt',
        name: 'Present/CRT (WebGPU)',
        present: true,
        stateOnly: true,
        shouldExecute: () => false,
        exec: () => { /* no-op */ },
        prepare: () => { /* set present state here when implemented */ },
    });
}

