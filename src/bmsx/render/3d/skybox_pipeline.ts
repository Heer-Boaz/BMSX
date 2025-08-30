// Skybox pipeline (formerly glview.skybox) inlined from legacy module.
import { AssetBarrier } from '../../core/assetbarrier';
import { $ } from '../../core/game';
import { taskGate } from '../../core/taskgate';
import skyboxFS from '../3d/shaders/skybox.frag.glsl';
import skyboxVS from '../3d/shaders/skybox.vert.glsl';
import { TextureHandle } from '../backend/pipeline_interfaces';
import { getRenderContext, RenderPassLibrary, SkyboxPipelineState } from '../backend/pipeline_registry';
import { TEXTURE_UNIT_SKYBOX } from '../backend/webgl.constants';
import { WebGLBackend } from '../backend/webgl_backend';
import { TextureKey } from '../texturemanager';
import { GameView, SkyboxImageIds } from '../view';

let vaoSkybox: WebGLVertexArrayObject | null = null;
let skyboxProgram: WebGLProgram; let skyboxPositionLocation: number; let skyboxViewLocation: WebGLUniformLocation; let skyboxProjectionLocation: WebGLUniformLocation; let skyboxTextureLocation: WebGLUniformLocation;
export let skyboxKey: TextureKey | undefined; export let skyboxFaceIds: SkyboxImageIds | undefined; const skyboxGroup = taskGate.group('texture:skybox:main');
let lastBoundSkyboxKey: TextureKey | undefined = undefined; let lastBoundSkyboxTexture: WebGLTexture | null = null;
export function resetSkyboxGroup() { skyboxGroup.bump(); }
export let skyboxBuffer: WebGLBuffer; export let skyboxTexture: WebGLTexture | null = null;
export function init(gl: WebGL2RenderingContext) { vaoSkybox = gl.createVertexArray()!; createSkyboxProgram(gl); setupSkyboxLocations(gl); createSkyboxBuffer(gl); gl.bindVertexArray(vaoSkybox); gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer); gl.vertexAttribPointer(skyboxPositionLocation, 3, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(skyboxPositionLocation); }
export function createSkyboxProgram(gl: WebGL2RenderingContext): void {
    // Prefer program that PipelineManager bound before bootstrap
    const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (current) { skyboxProgram = current; return; }
    const b = getRenderContext().backend as WebGLBackend;
    const program = b.buildProgram(skyboxVS, skyboxFS, 'skybox');
    if (!program) throw Error('Failed to build skybox shader program');
    skyboxProgram = program;
}
export function setupSkyboxLocations(gl: WebGL2RenderingContext): void {
    if (!skyboxProgram) {
        const current = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
        if (!current) throw new Error('Skybox program not bound during bootstrap');
        skyboxProgram = current;
    }
    skyboxPositionLocation = gl.getAttribLocation(skyboxProgram, 'a_position');
    skyboxViewLocation = gl.getUniformLocation(skyboxProgram, 'u_view')!;
    skyboxProjectionLocation = gl.getUniformLocation(skyboxProgram, 'u_projection')!;
    skyboxTextureLocation = gl.getUniformLocation(skyboxProgram, 'u_skybox')!;
    gl.uniform1i(skyboxTextureLocation, TEXTURE_UNIT_SKYBOX);
}
export function createSkyboxBuffer(gl: WebGL2RenderingContext): void {
    // 36 vertices (12 triangles) cube; each face rendered separately
    const p = new Float32Array([
        // Front
        -1, -1, 1, 1, -1, 1, 1, 1, 1,
        -1, -1, 1, 1, 1, 1, -1, 1, 1,
        // Back
        -1, -1, -1, -1, 1, -1, 1, 1, -1,
        -1, -1, -1, 1, 1, -1, 1, -1, -1,
        // Top
        -1, 1, -1, -1, 1, 1, 1, 1, 1,
        -1, 1, -1, 1, 1, 1, 1, 1, -1,
        // Bottom
        -1, -1, -1, 1, -1, -1, 1, -1, 1,
        -1, -1, -1, 1, -1, 1, -1, -1, 1,
        // Right
        1, -1, -1, 1, 1, -1, 1, 1, 1,
        1, -1, -1, 1, 1, 1, 1, -1, 1,
        // Left
        -1, -1, -1, -1, -1, 1, -1, 1, 1,
        -1, -1, -1, -1, 1, 1, -1, 1, -1,
    ]);
    skyboxBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, p, gl.STATIC_DRAW);
}
export function setSkyboxImages(ids: SkyboxImageIds) { const loaders = [GameView.imgassets[ids.posX].imgbin, GameView.imgassets[ids.negX].imgbin, GameView.imgassets[ids.posY].imgbin, GameView.imgassets[ids.negY].imgbin, GameView.imgassets[ids.posZ].imgbin, GameView.imgassets[ids.negZ].imgbin] as const; skyboxKey = $.texmanager.acquireCubemap({ name: "skybox/main", faceLoaders: loaders, faceIdsForKey: [ids.posX, ids.negX, ids.posY, ids.negY, ids.posZ, ids.negZ] as const, assetBarrier: new AssetBarrier<WebGLTexture>(skyboxGroup), desc: {}, fallbackColor: [255, 0, 0, 255], streamed: true }); skyboxFaceIds = ids; lastBoundSkyboxKey = undefined; lastBoundSkyboxTexture = null; }
export interface SkyboxPassState { view: Float32Array; proj: Float32Array; tex: WebGLTexture; width?: number; height?: number; }
export function drawSkyboxWithState(gl: WebGL2RenderingContext, framebuffer: WebGLFramebuffer, state: SkyboxPassState): void {
    // FBO binding handled by render graph
    const backend = getRenderContext().backend as WebGLBackend;
    if (state.width && state.height) backend.setViewport({ x: 0, y: 0, w: state.width, h: state.height });
    // Render skybox as background: no culling (render inside faces), no depth writes, depth test LEQUAL
    backend.setCullEnabled(false);
    backend.setDepthMask(false);
    backend.setDepthTestEnabled(true);
    backend.setDepthFunc((backend.gl as WebGL2RenderingContext).LEQUAL);
    // Program is bound by the backend pipeline
    backend.bindVertexArray(vaoSkybox);
    gl.uniformMatrix4fv(skyboxViewLocation, false, state.view);
    gl.uniformMatrix4fv(skyboxProjectionLocation, false, state.proj);
    if (lastBoundSkyboxTexture !== state.tex) {
        const v = getRenderContext();
        v.activeTexUnit = TEXTURE_UNIT_SKYBOX;
        v.bindCubemapTex(state.tex);
        lastBoundSkyboxTexture = state.tex;
        lastBoundSkyboxKey = skyboxKey;
    }
    const passStub = { fbo: framebuffer, desc: { label: 'skybox' } } as any;
    backend.draw(passStub, 0, 36);
    backend.bindVertexArray(null);
}

export function registerSkyboxPass_WebGL(registry: RenderPassLibrary) {
    registry.register({
        id: 'skybox',
        label: 'skybox',
        name: 'Skybox',
        vsCode: skyboxVS,
        fsCode: skyboxFS,
        bindingLayout: {
            uniforms: ['FrameUniforms'],
            textures: [{ name: 'u_skybox' }],
            samplers: [{ name: 's_skybox' }],
        },
        bootstrap: (backend) => {
            const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
            init(gl);
        },
        writesDepth: true,
        shouldExecute: () => !!$.model.activeCamera3D && !!skyboxKey,
        exec: (backend, fbo, s) => {
            const gl = (backend as WebGLBackend).gl as WebGL2RenderingContext;
            drawSkyboxWithState(gl, fbo as WebGLFramebuffer, s as SkyboxPipelineState);
        },
        prepare: (backend, _state) => {
            const gv = getRenderContext();
            const width = gv.offscreenCanvasSize.x; const height = gv.offscreenCanvasSize.y;
            const cam = $.model.activeCamera3D;
            if (!cam) return;
            const tex = $.texmanager.getTexture(skyboxKey) as TextureHandle | undefined;
            if (!tex) return;
            // Update state with dynamic data
            registry.setState('skybox', { width, height, view: cam.skyboxView, proj: cam.projection, tex });
            registry.validatePassResources('skybox', backend);
        },
    });
}
