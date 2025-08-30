import { PipelineRegistry } from '../backend/pipeline_registry';

// WebGPU stub: registers the Particles pass for WebGPU builds.
export function registerParticlesPass_WebGPU(registry: PipelineRegistry): void {
    registry.register({
        id: 'particles',
        label: 'particles',
        name: 'Particles (WebGPU)',
        writesDepth: true,
        stateOnly: true,
        shouldExecute: () => false,
        exec: () => { /* no-op */ },
        prepare: () => { /* set particle state here when implemented */ },
    });
}

