// Generic pipeline manager enabling dynamic (runtime) registration of pipelines
// using string labels (no enum) and strongly-typed (generic) state without any casts.
// A pipeline may optionally provide shader sources; when provided they are compiled
// immediately and the linked program stored. Pipelines can also be pure wrapper
// executors that delegate to higher level modules.

export interface RegisteredPipeline<State> {
    id: string;
    label: string; // duplicate of id for clarity / debugging
    program?: WebGLProgram | null;
    uniforms?: Map<string, WebGLUniformLocation | null>;
    state?: State;
    exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null, state: State) => void;
    prepare?: (gl: WebGL2RenderingContext, state: State) => void; // optional per-frame pre-exec hook
}

export interface PipelineDescriptor<State> {
    id: string; // unique string id
    vsCode?: string;
    fsCode?: string;
    uniforms?: string[]; // uniform names (queried & cached if shaders provided)
    // Optional custom shader program builder (allows games to override compile flags)
    buildProgram?: (gl: WebGL2RenderingContext, vs: string, fs: string, label: string) => WebGLProgram | null;
    // Execute callback (required). Program is already bound if shaders were supplied.
    exec: (gl: WebGL2RenderingContext, fbo: WebGLFramebuffer | null, state: State) => void;
    // Optional per-frame prepare hook (e.g. to update dynamic uniforms/buffers)
    prepare?: (gl: WebGL2RenderingContext, state: State) => void;
}

export class PipelineManager {
    private pipelines = new Map<string, RegisteredPipeline<unknown>>();

    constructor(private gl: WebGL2RenderingContext) { }

    private compileShader(type: number, source: string, label: string): WebGLShader {
        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error(`Failed to create shader (${label})`);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? 'Unknown error';
            gl.deleteShader(shader);
            throw new Error(`Shader compile failed (${label}): ${log}`);
        }
        return shader;
    }

    private linkProgram(vs: WebGLShader, fs: WebGLShader, label: string): WebGLProgram {
        const gl = this.gl;
        const prog = gl.createProgram();
        if (!prog) throw new Error(`Failed creating program (${label})`);
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog) ?? 'Unknown error';
            gl.deleteProgram(prog);
            throw new Error(`Program link failed (${label}): ${log}`);
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        return prog;
    }

    register<State>(desc: PipelineDescriptor<State>): void {
        if (this.pipelines.has(desc.id)) throw new Error(`Pipeline '${desc.id}' already registered`);
        let program: WebGLProgram | null = null;
        let uniforms: Map<string, WebGLUniformLocation | null> | undefined;
        if (desc.vsCode && desc.fsCode) {
            try {
                const build = desc.buildProgram ?? ((gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string, label: string) => {
                    const vs = this.compileShader(gl.VERTEX_SHADER, vsSrc, `${label}-vs`);
                    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc, `${label}-fs`);
                    return this.linkProgram(vs, fs, label);
                });
                program = build(this.gl, desc.vsCode, desc.fsCode, desc.id);
                if (desc.uniforms && program) {
                    uniforms = new Map();
                    for (const u of desc.uniforms) uniforms.set(u, this.gl.getUniformLocation(program, u));
                }
            } catch (e) {
                // Fail registration explicitly so caller can fallback
                throw e;
            }
        }
        const pipeline: RegisteredPipeline<State> = {
            id: desc.id,
            label: desc.id,
            program,
            uniforms,
            exec: desc.exec,
            prepare: desc.prepare,
        };
        this.pipelines.set(desc.id, pipeline as RegisteredPipeline<unknown>);
    }

    setState<State>(id: string, state: State): void {
        const p = this.pipelines.get(id);
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        (p as RegisteredPipeline<State>).state = state; // assignment only; retrieval typed via generic accessor
    }

    getState<State>(id: string): State | undefined {
        const p = this.pipelines.get(id);
        return p ? (p as RegisteredPipeline<State>).state : undefined;
    }

    execute<State>(id: string, fbo: WebGLFramebuffer | null): void {
        const p = this.pipelines.get(id) as RegisteredPipeline<State> | undefined;
        if (!p) throw new Error(`Pipeline '${id}' not found`);
        if (!p.state) return; // nothing to draw if no state set
        const gl = this.gl;
        if (p.program) gl.useProgram(p.program);
        if (p.prepare) p.prepare(gl, p.state as State);
        p.exec(gl, fbo, p.state as State);
    }

    has(id: string): boolean { return this.pipelines.has(id); }

    // Expose low-level registration for external ROM hooks (typed wrapper elsewhere)
    get _gl(): WebGL2RenderingContext { return this.gl; }
    _registerRaw = <State>(desc: PipelineDescriptor<State>) => this.register(desc);
}

export type { PipelineManager as DefaultPipelineManager };
