// Graphics pipeline manager: single place to register passes and execute them
// Simplified to avoid coupling with the render graph internals.

import { GPUBackend, GraphicsPipelineBuildDesc, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle } from './pipeline_interfaces';

interface RegisteredPass {
    id: string;
    prepare?: (backend: GPUBackend, state: unknown) => void;
    exec: (backend: GPUBackend, fbo: unknown, state: unknown) => void;
    pipelineHandle?: RenderPassInstanceHandle | null;
    state?: unknown;
}

export class GraphicsPipelineManager {
    private pipelines = new Map<string, RegisteredPass>();

    constructor(private backend: GPUBackend) { }

    register(desc: RenderPassDef): void {
        if (this.pipelines.has(desc.id)) throw new Error(`Pipeline '${desc.id}' already registered`);
        let pipelineHandle: RenderPassInstanceHandle | null = null;
        if (this.backend.createRenderPassInstance && (desc.vsCode || desc.fsCode)) {
            const build: GraphicsPipelineBuildDesc = {
                label: desc.label ?? desc.name,
                vsCode: desc.vsCode,
                fsCode: desc.fsCode,
                bindingLayout: desc.bindingLayout,
            };
            pipelineHandle = this.backend.createRenderPassInstance(build);
        }
        const pipeline: RegisteredPass = {
            id: desc.id,
            pipelineHandle,
            exec: desc.exec,
            prepare: desc.prepare,
        };
        // One-time pass bootstrap for persistent GPU resources (optional)
        if (desc.bootstrap) {
            // Bind the created pipeline so bootstrap can query attrib/uniform locations
            if (pipelineHandle && this.backend.setGraphicsPipeline) {
                const stubPass = { fbo: null, desc: { label: desc.id } as RenderPassDesc } as any;
                this.backend.setGraphicsPipeline(stubPass, pipelineHandle);
            }
            desc.bootstrap(this.backend);
        }
        this.pipelines.set(desc.id, pipeline);
    }

    setState(id: string, state: unknown): void {
        const p = this.pipelines.get(id);
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        p.state = state;
    }

    getState<T = unknown>(id: string): T | undefined {
        const p = this.pipelines.get(id);
        return p ? (p.state as T) : undefined;
    }

    execute(id: string, fbo: unknown): void {
        const p = this.pipelines.get(id);
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        const backend = this.backend;
        // Bind program/pipeline before prepare so uniforms can be set
        if (p.pipelineHandle && backend.setGraphicsPipeline) {
            const stubPass = { fbo, desc: { label: id } as RenderPassDesc } as any;
            backend.setGraphicsPipeline(stubPass, p.pipelineHandle);
        }
        if (p.prepare) p.prepare(backend, p.state);
        p.exec(backend, fbo, p.state);
    }

    has(id: string): boolean { return this.pipelines.has(id); }
}

export type { GraphicsPipelineManager as DefaultPipelineManager };
