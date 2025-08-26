import { AmbientLight, DirectionalLight, PointLight } from '../..';
import { multiply_vec } from '../../core/utils';
import type { Polygon, Size, vec2 } from '../../rompack/rompack';
import { Identifier } from '../../rompack/rompack';
import * as SpritesPipeline from '../2d/sprites_pipeline';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { WebGLBackend } from '../backend/webgl_backend';
import { buildFrameGraph } from '../graph/build_framegraph';
import { buildDrawCommands } from '../graph/drawcommandbuilder';
import { buildFrameData } from '../graph/framedata';
import { FrameData, RenderGraphRuntime } from '../graph/rendergraph';
import { LightingSystem } from '../lighting/lightingsystem';
import { BaseView, Color, DrawImgOptions, DrawMeshOptions, DrawRectOptions, generateAtlasName, renderGate, SkyboxImageIds } from '../view';

// Debug flag (disabled now that graph is validated)
const DEBUG_INJECT_TEST_SPRITE = false;
// Texture unit constants (migrated from legacy glview.ts)
export const TEXTURE_UNIT_ATLAS = 0;
export const TEXTURE_UNIT_ATLAS_DYNAMIC = 1;
export const TEXTURE_UNIT_ALBEDO = 2;
export const TEXTURE_UNIT_NORMAL = 3;
export const TEXTURE_UNIT_METALLIC_ROUGHNESS = 4;
export const TEXTURE_UNIT_SHADOW_MAP = 5;
export const TEXTURE_UNIT_SKYBOX = 6;
export const TEXTURE_UNIT_PARTICLE = 7;
export const TEXTURE_UNIT_POST_PROCESSING_SOURCE = 8;
export const TEXTURE_UNIT_UPLOAD = 15;

export class RenderView extends BaseView {
    public glctx: WebGL2RenderingContext;
    private backend: WebGLBackend | null = null;
    public renderGraph: RenderGraphRuntime | null = null;
    public rgColor: number | null = null;
    public rgDepth: number | null = null;
    private graphInvalid = true;
    private lightingSystem: LightingSystem | null = null;
    public offscreenCanvasSize: vec2;
    private isRendering = false;
    private needsResize = false;
    private framebuffer: WebGLFramebuffer | null = null;
    private depthBuffer: WebGLRenderbuffer | null = null;
    public textures: { [k: string]: WebGLTexture | null } = {};
    private _dynamicAtlasIndex: number | null = null;
    // Texture binding cache (migrated from legacy RenderView shim)
    private _activeTexUnit: number | null = null;
    private _activeTexture2D: WebGLTexture | null = null;
    private _activeCubemap: WebGLTexture | null = null;
    // CRT post-process option fields (read by frame data + pipeline registry via bracket access)
    public applyNoise = true;
    public applyColorBleed = true;
    public applyScanlines = true;
    public applyBlur = true;
    public applyGlow = true;
    public applyFringing = true;
    public noiseIntensity = 0.4;
    public colorBleed: [number, number, number] = [0.02, 0.0, 0.0];
    public blurIntensity = 0.6;
    public glowColor: [number, number, number] = [0.12, 0.10, 0.09];

    constructor(viewport: Size) {
        super(viewport, multiply_vec(viewport, 2));
        this.offscreenCanvasSize = multiply_vec(viewport, 2);
        this.glctx = this.canvas.getContext('webgl2', { alpha: true, antialias: false }) as WebGL2RenderingContext;
    }
    public getBackend(): WebGLBackend { if (!this.backend) this.backend = new WebGLBackend(this.glctx); return this.backend; }
    override init(): void {
        super.init();
        const gl = this.glctx;
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.enable(gl.BLEND); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        MeshPipeline.init(gl, this.offscreenCanvasSize); SkyboxPipeline.init(gl); ParticlesPipeline.init(gl); SpritesPipeline.createSpriteShaderPrograms(gl); MeshPipeline.createGameShaderPrograms3D(gl); ParticlesPipeline.createParticleProgram(gl); SpritesPipeline.setupSpriteShaderLocations(gl); MeshPipeline.setupVertexShaderLocations3D(gl); ParticlesPipeline.setupParticleLocations(gl);
        SpritesPipeline.setupBuffers(gl); MeshPipeline.setupBuffers3D(gl); SpritesPipeline.setupSpriteLocations(gl);
        // IMPORTANT: set default uniform values (resolution, scale, texture units) for sprite & mesh pipelines
        SpritesPipeline.setupDefaultUniformValues(gl, 1.0, [this.offscreenCanvasSize.x, this.offscreenCanvasSize.y] as unknown as [number, number]);
        MeshPipeline.setDefaultUniformValues(gl, 1.0);
        this.setupTextures(); this.createFramebuffer(); this.handleResize();
        this.rebuildGraph();
    }
    private setupTextures(): void {
        const gl = this.glctx;
        this.textures['_atlas'] = WebGLBackend.glCreateTexture(gl, BaseView.imgassets['_atlas']?._imgbin, undefined, 0);
        this.textures['_atlas_dynamic'] = WebGLBackend.glCreateTexture(gl, null, { x: 1, y: 1 }, 1);
        this.textures['post_processing_source_texture'] = null;
    }
    private createFramebuffer(): void {
        const gl = this.glctx;
        if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
        if (this.textures['post_processing_source_texture']) gl.deleteTexture(this.textures['post_processing_source_texture']);
        const w = this.offscreenCanvasSize.x, h = this.offscreenCanvasSize.y;
        this.textures['post_processing_source_texture'] = WebGLBackend.glCreateTexture(gl, undefined, { x: w, y: h }, 8);
        this.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures['post_processing_source_texture'], 0);
        this.depthBuffer = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    override handleResize(): void {
        if (this.isRendering) { this.needsResize = true; return; }
        super.handleResize();
        // Refresh resolution-dependent uniforms after size change
        try {
            SpritesPipeline.setupDefaultUniformValues(this.glctx, 1.0, [this.offscreenCanvasSize.x, this.offscreenCanvasSize.y] as unknown as [number, number]);
            MeshPipeline.setDefaultUniformValues(this.glctx, 1.0);
        } catch { /* ignore if not yet initialized */ }
        this.graphInvalid = true;
    }
    override drawgame(clearCanvas = true): void { if (!renderGate.ready) return; const token = renderGate.begin({ blocking: true, tag: 'frame' }); try { this.isRendering = true; this.execute(clearCanvas); if (this.needsResize) this.handleResize(); } finally { this.isRendering = false; renderGate.end(token); } }
    private execute(clearCanvas: boolean): void {
        const frame: FrameData = buildFrameData(this as any);
        if (DEBUG_INJECT_TEST_SPRITE) {
            // Draw a magenta pixel at 10,10 to test sprite path
            SpritesPipeline.drawImg(this as any, { imgid: 'whitepixel', pos: { x: 10, y: 10, z: 0 }, scale: { x: 4, y: 4 } });
        }
        frame.drawCommands = buildDrawCommands(this as any);
        this.drawbase(clearCanvas);
        if (!this.renderGraph || this.graphInvalid) this.rebuildGraph();
        this.renderGraph!.execute(frame);
        const stats = this.renderGraph!.getPassStats();
    }
    public rebuildGraph(): void { if (!this.backend) this.backend = new WebGLBackend(this.glctx); if (!this.lightingSystem) this.lightingSystem = new LightingSystem(this.glctx); this.renderGraph = buildFrameGraph(this as any, this.lightingSystem); this.graphInvalid = false; }
    override clear(): void { const gl = this.glctx; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
    // Legacy clear above relied on an internal framebuffer; with the render graph active the graph's Clear pass handles clears.
    // TODO: remove calls to clear() from higher level once migration completes.
    override drawImg(o: DrawImgOptions): void { SpritesPipeline.drawImg(this as any, o); }
    override drawRectangle(o: DrawRectOptions): void { SpritesPipeline.drawRectangle(this as any, o); }
    override fillRectangle(o: DrawRectOptions): void { SpritesPipeline.fillRectangle(this as any, o); }
    override drawPolygon(points: Polygon, z: number, color: Color, thickness: number): void { SpritesPipeline.drawPolygon(this as any, points, z, color, thickness); }
    override drawMesh(o: DrawMeshOptions): void { MeshPipeline.meshesToDraw.push(o); }
    override getPointLight(id: Identifier): PointLight | undefined { return MeshPipeline.getPointLight(id); }
    override setPointLight(id: Identifier, light: PointLight): void { MeshPipeline.addPointLight(this.glctx, id, light); }
    override removePointLight(id: Identifier): void { MeshPipeline.removePointLight(this.glctx, id); }
    override addDirectionalLight(id: Identifier, light: DirectionalLight): void { MeshPipeline.addDirectionalLight(this.glctx, id, light); }
    override removeDirectionalLight(id: Identifier): void { MeshPipeline.removeDirectionalLight(this.glctx, id); }
    override setAmbientLight(light: AmbientLight): void { MeshPipeline.setAmbientLight(this.glctx, light); }
    override clearLights(): void { MeshPipeline.clearLights(this.glctx); }
    override setSkybox(images: SkyboxImageIds): void { SkyboxPipeline.setSkyboxImages(images); }
    override get skyboxFaceIds(): SkyboxImageIds | undefined { return SkyboxPipeline.skyboxFaceIds; }
    override get dynamicAtlas(): number | null { return this._dynamicAtlasIndex; }
    override set dynamicAtlas(index: number | null) { if (this._dynamicAtlasIndex === index) return; if (this.textures['_atlas_dynamic']) { this.glctx.deleteTexture(this.textures['_atlas_dynamic']); this.textures['_atlas_dynamic'] = null; } this._dynamicAtlasIndex = index; if (index == null) { this.glctx.activeTexture(this.glctx.TEXTURE1); this.glctx.bindTexture(this.glctx.TEXTURE_2D, null); return; } const atlasName = generateAtlasName(index); const atlasImage = BaseView.imgassets[atlasName]?._imgbin; if (!atlasImage) { console.error(`Atlas '${atlasName}' not found`); return; } this.textures['_atlas_dynamic'] = WebGLBackend.glCreateTexture(this.glctx, atlasImage, { x: atlasImage.width, y: atlasImage.height }, 1); }
    override reset(): void { }

    // Texture binding helpers (legacy compatibility)
    get activeTexUnit(): number | null { return this._activeTexUnit; }
    set activeTexUnit(u: number | null) { this._activeTexUnit = u; if (u != null) this.glctx.activeTexture(this.glctx.TEXTURE0 + u); }
    bind2DTex(tex: WebGLTexture | null): void { if (this._activeTexture2D === tex) return; this.glctx.bindTexture(this.glctx.TEXTURE_2D, tex); this._activeTexture2D = tex; }
    bindCubemapTex(tex: WebGLTexture | null): void { if (this._activeCubemap === tex) return; this.glctx.bindTexture(this.glctx.TEXTURE_CUBE_MAP, tex); this._activeCubemap = tex; }
    // Temporary accessor for legacy helpers (to be removed with post-process refactor)
    get _legacyFramebuffer(): WebGLFramebuffer | null { return this.framebuffer; }
}
