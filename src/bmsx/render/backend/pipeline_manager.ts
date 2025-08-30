// Graphics pipeline manager: single place to register passes and execute them
// Simplified to avoid coupling with the render graph internals.

import { GPUBackend, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDef, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateRegistry } from './pipeline_interfaces';
import { FRAME_UNIFORM_BINDING } from './frame_uniforms';
import { checkWebGLError } from './webgl.helpers';

interface RegisteredPass<SMap extends object> {
    id: string;
    prepare?: (backend: GPUBackend, state: SMap[keyof SMap] | undefined) => void;
    exec: (backend: GPUBackend, fbo: unknown, state: SMap[keyof SMap] | undefined) => void;
    pipelineHandle?: RenderPassInstanceHandle | null;
    state?: SMap[keyof SMap];
    bindingLayout?: RenderPassDef['bindingLayout'];
}

export class GraphicsPipelineManager<SMap extends object = RenderPassStateRegistry> {
    private pipelines = new Map<string, RegisteredPass<SMap>>();

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
        const pipeline: RegisteredPass<SMap> = {
            id: desc.id,
            pipelineHandle,
            exec: desc.exec,
            prepare: desc.prepare,
            bindingLayout: desc.bindingLayout,
        };
        // One-time pass bootstrap for persistent GPU resources (optional)
        if (desc.bootstrap) {
            // Bind the created pipeline so bootstrap can query attrib/uniform locations
            if (pipelineHandle && this.backend.setGraphicsPipeline) {
                const stubPass: PassEncoder = { fbo: null, desc: { label: desc.id } as RenderPassDesc };
                this.backend.setGraphicsPipeline(stubPass, pipelineHandle);
            }
            desc.bootstrap(this.backend);
            checkWebGLError(`after bootstrap ${desc.id}`);
        }
        this.pipelines.set(desc.id, pipeline);
    }

    setState<PState extends keyof SMap & string>(id: PState, state: SMap[PState]): void {
        const p = this.pipelines.get(id);
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        p.state = state;
    }

    getState<PState extends keyof SMap & string>(id: PState): SMap[PState] | undefined {
        const p = this.pipelines.get(id);
        return p ? (p.state as SMap[PState]) : undefined;
    }

    execute(id: string, fbo: unknown): void {
        const p = this.pipelines.get(id);
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        const backend = this.backend;
        checkWebGLError(`before binding pipeline ${id}`);
        // Bind program/pipeline before prepare so uniforms can be set
        if (p.pipelineHandle && backend.setGraphicsPipeline) {
            const stubPass: PassEncoder = { fbo, desc: { label: id } as RenderPassDesc };
            backend.setGraphicsPipeline(stubPass, p.pipelineHandle);
        }
        // Ensure standard uniform blocks are consistently bound when present in the declared layout
        const uniforms = p.bindingLayout?.uniforms ?? [];
        if (uniforms.length && backend.setUniformBlockBinding) {
            for (const u of uniforms) {
                if (u === 'FrameUniforms') backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
                if (u === 'DirLightBlock') backend.setUniformBlockBinding('DirLightBlock', 0);
                if (u === 'PointLightBlock') backend.setUniformBlockBinding('PointLightBlock', 1);
            }
        }
        checkWebGLError(`after binding pipeline ${id}`);
        if (p.prepare) p.prepare(backend, p.state);
        checkWebGLError(`after preparing pipeline ${id}`);
        p.exec(backend, fbo, p.state);
        checkWebGLError(`after executing pipeline ${id}`);
    }

    has(id: string): boolean { return this.pipelines.has(id); }
}

export type { GraphicsPipelineManager as DefaultPipelineManager };
