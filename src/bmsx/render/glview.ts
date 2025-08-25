import { multiply_vec, to_vec2arr } from '../core/utils';
import type { Polygon, Size, vec2, vec3arr } from '../rompack/rompack';
import { Identifier } from '../rompack/rompack';
import { checkWebGLError } from './glview.helpers';

import { glCreateTexture, glSwitchProgram } from './glutils';
import { catchWebGLError } from './glview.helpers';
import { generateAtlasName, renderGate } from './view';

import * as GLView2D from './2d/glview.2d';
import { BaseView, Color, DrawImgOptions, DrawMeshOptions, DrawRectOptions, SkyboxImageIds } from './view';

import { $, AmbientLight, DirectionalLight, PointLight } from '..';
import { Atmosphere } from './3d/atmosphere';
import * as GLView3D from './3d/glview.3d';
import * as GLViewParticles from './3d/glview.particles';
import * as GLViewSkybox from './3d/glview.skybox';
import { M4 } from './3d/math3d';
import { PipelineId, WebGLBackend } from './gpu_backend';
import { buildDrawCommands } from './graph/drawcommandbuilder';
import { buildFrameData } from './graph/framedata';
import { FrameData, RenderGraphRuntime, RGCommandKind, RGTexHandle } from './graph/rendergraph';
import { isAmbientLight, LightingSystem } from './lighting/lightingsystem';
import * as GLViewCRT from './post/glview.crt';

type texturetype = '_atlas' | '_atlas_dynamic' | 'post_processing_source_texture';

export const TEXTURE_UNIT_ATLAS = 0;
export const TEXTURE_UNIT_ATLAS_DYNAMIC = 1;
export const TEXTURE_UNIT_ALBEDO = 2;
export const TEXTURE_UNIT_NORMAL = 3;
export const TEXTURE_UNIT_METALLIC_ROUGHNESS = 4;
export const TEXTURE_UNIT_SHADOW_MAP = 5;
export const TEXTURE_UNIT_SKYBOX = 6;
export const TEXTURE_UNIT_PARTICLE = 7;
export const TEXTURE_UNIT_POST_PROCESSING_SOURCE = 8;
export const TEXTURE_UNIT_UPLOAD = 15; // For uploading textures, not rendering
/**
 * Represents a view that renders graphics using WebGL.
 */
export class GLView extends BaseView {
	/**
	 * The WebGL rendering context used for rendering the game.
	 */
	public glctx: WebGL2RenderingContext; // TODO: Remove public access, which is only used for catching WebGL errors
	private textures: { [key in texturetype]: WebGLTexture; };

	public framebuffer: WebGLFramebuffer;
	private depthBuffer: WebGLBuffer;
	private isRendering: boolean = false;
	private needsResize: boolean = false;

	// Render graph integration
	public renderGraph: RenderGraphRuntime | null = null;
	private rgColor: RGTexHandle | null = null;
	private rgDepth: RGTexHandle | null = null;
	private backend: WebGLBackend | null = null; // persistent backend for shader program creation & graph
	private graphInvalid: boolean = true;
	private logPassStats: boolean = false; // enable to console.log per-pass timings
	private passStatsOverlay: HTMLDivElement | null = null;
	private passStatsTotals: { [name: string]: { frames: number; total: number } } = {};
	private frameTimes: number[] = [];
	private frameTimeBufferSize: number = 120; // rolling window ~2s at 60fps
	private lastFrameStart: number = 0;
	private overlayHotkeyRegistered: boolean = false;
	private overlayThemeIndex: number = 0; // cycles themes

	public getBackend(): WebGLBackend {
		if (!this.backend) this.backend = new WebGLBackend(this.glctx);
		return this.backend;
	}

	private _currentBoundTextureUnit: number | null = null;
	private _activeTexture: WebGLTexture | null = null;
	private _activeCubemap: WebGLTexture | null = null;

	public set activeTexUnit(unit: number) {
		if (this._currentBoundTextureUnit !== unit) {
			this.glctx.activeTexture(this.glctx.TEXTURE0 + unit);
			this._currentBoundTextureUnit = unit;
		}
	}

	public get activeTexUnit(): number | null {
		return this._currentBoundTextureUnit;
	}

	public bind2DTex(tex: WebGLTexture): void {
		if (this._activeTexture !== tex) {
			this.glctx.bindTexture(this.glctx.TEXTURE_2D, tex);
			this._activeTexture = tex;
		}
	}

	public bindCubemapTex(tex: WebGLTexture): void {
		if (this._activeCubemap !== tex) {
			this.glctx.bindTexture(this.glctx.TEXTURE_CUBE_MAP, tex);
			this._activeCubemap = tex;
		}
	}

	private _applyNoise: boolean = true;
	private _applyColorBleed: boolean = true;
	private _applyScanlines: boolean = true;
	private _applyBlur: boolean = true;
	private _applyGlow: boolean = true;
	private _applyFringing: boolean = true;
	private _noiseIntensity: number = 0.4;
	private _colorBleed: vec3arr = [0.02, 0.0, 0.0];
	private _blurIntensity: number = 0.6;
	// private _glowColor: vec3arr = [0.05, 0.02, 0.02];// warm white bloom
	private _glowColor: vec3arr = [0.12, 0.10, 0.09];// warm white bloom

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply noise.
	 */
	public get applyNoise(): boolean {
		return this._applyNoise;
	}

	public set applyNoise(value: boolean) {
		this._applyNoise = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyNoise: value });
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply color bleed.
	 */
	public get applyColorBleed(): boolean {
		return this._applyColorBleed;
	}

	public set applyColorBleed(value: boolean) {
		this._applyColorBleed = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyColorBleed: value });
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply scanlines.
	 */
	public get applyScanlines(): boolean {
		return this._applyScanlines;
	}

	public set applyScanlines(value: boolean) {
		this._applyScanlines = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyScanlines: value });
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply blur.
	 */
	public get applyBlur(): boolean {
		return this._applyBlur;
	}

	public set applyBlur(value: boolean) {
		this._applyBlur = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyBlur: value });
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply glow.
	 */
	public get applyGlow(): boolean {
		return this._applyGlow;
	}

	public set applyGlow(value: boolean) {
		this._applyGlow = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyGlow: value });
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply fringing.
	 */
	public get applyFringing(): boolean {
		return this._applyFringing;
	}

	public set applyFringing(value: boolean) {
		this._applyFringing = value;
		GLViewCRT.setCrtOptions(this.glctx, { applyFringing: value });
	}

	public get noiseIntensity(): number {
		return this._noiseIntensity;
	}

	public set noiseIntensity(value: number) {
		this._noiseIntensity = value;
		GLViewCRT.setCrtOptions(this.glctx, { noiseIntensity: value });
	}

	public get colorBleed(): vec3arr {
		return this._colorBleed;
	}

	public set colorBleed(value: vec3arr) {
		this._colorBleed = value;
		GLViewCRT.setCrtOptions(this.glctx, { colorBleed: value });
	}

	public get blurIntensity(): number {
		return this._blurIntensity;
	}

	public set blurIntensity(value: number) {
		this._blurIntensity = value;
		GLViewCRT.setCrtOptions(this.glctx, { blurIntensity: value });
	}

	public get glowColor(): vec3arr {
		return this._glowColor;
	}

	public set glowColor(value: vec3arr) {
		this._glowColor = value;
		GLViewCRT.setCrtOptions(this.glctx, { glowColor: value });
	}

	public offscreenCanvasSize: vec2;

	/**
	 * Initializes a new instance of the GLView class with the specified viewport size.
	 * Note that the offscreen canvas size is twice the viewport size to allow for the CRT shader effect to be more granular.
	 * @param viewportsize
	 */
	constructor(viewportsize: Size, crtOptions?: { noiseIntensity?: number; colorBleed?: vec3arr; blurIntensity?: number; glowColor?: vec3arr }) {
		super(viewportsize, multiply_vec(viewportsize, 2));
		this.offscreenCanvasSize = multiply_vec(viewportsize, 2); // The offscreen canvas size is twice the viewport size
		if (crtOptions) {
			this._noiseIntensity = crtOptions.noiseIntensity ?? this._noiseIntensity;
			this._colorBleed = crtOptions.colorBleed ?? this._colorBleed;
			this._blurIntensity = crtOptions.blurIntensity ?? this._blurIntensity;
			this._glowColor = crtOptions.glowColor ?? this._glowColor;
		}
		this.glctx = this.canvas.getContext('webgl2', {
			alpha: true,
			desynchronized: false,
			preserveDrawingBuffer: false,
			antialias: false,
		}) as WebGL2RenderingContext;
	}

	/**
	 * Initializes the GLView by setting up the WebGL context, creating the game and CRT shader programs, setting up the vertex shader locations,
	 * creating the buffers, setting up the game shader locations, setting up the textures, creating the CRT shader programs,
	 * setting up the CRT shader locations, creating the CRT vertex buffer, creating the CRT shader texcoord buffer,
	 * setting the default uniform values, and creating the framebuffer and texture.
	 * @private
	 * @returns void
	 */
	override init(): void {
		super.init(); // Call the base init method to set up the canvas
		const gl = this.glctx;
		this.setupGLContext(); // Set up the WebGL context
		GLView3D.init(gl, this.offscreenCanvasSize);
		checkWebGLError('After GLView3D.init');
		GLViewSkybox.init(gl);
		checkWebGLError('After GLViewSkybox.init');
		GLViewParticles.init(gl);
		checkWebGLError('After GLViewParticles.init');

		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLView2D.createSpriteShaderPrograms(gl); // Create the game shader programs
		checkWebGLError('After GLView2D.createSpriteShaderPrograms');
		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLView3D.createGameShaderPrograms3D(gl); // Create 3D shader program
		checkWebGLError('After GLView3D.createGameShaderPrograms3D');
		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLViewParticles.createParticleProgram(gl);
		checkWebGLError('After GLViewParticles.createParticleProgram');
		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLView2D.setupSpriteShaderLocations(gl); // Set up the vertex shader locations for the game shader program
		checkWebGLError('After GLView2D.setupSpriteShaderLocations');
		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLView3D.setupVertexShaderLocations3D(gl); // Set up the vertex shader locations for the 3D shader
		checkWebGLError('After GLView3D.setupVertexShaderLocations3D');
		// TODO: MUST USE GPUBACKEND FOR THIS!
		GLViewParticles.setupParticleLocations(gl);
		checkWebGLError('After GLViewParticles.setupParticleLocations');
		this.setupBuffers(); // Set up the buffers for the game shader
		checkWebGLError('After setupBuffers');
		GLView2D.setupSpriteLocations(gl); // Set up the game shader locations
		checkWebGLError('After setupSpriteLocations');
		// GLView3D.setupGameShader3DLocations(gl); // Set up locations for 3D shader
		this.setupTextures(); // Set up the textures used by the shaders (such as the atlas texture and the post-processing shader texture)
		checkWebGLError('After setupTextures');
		GLViewCRT.createCRTShaderPrograms(gl); // Create the CRT shader programs
		checkWebGLError('After createCRTShaderPrograms');
		GLViewCRT.setupCRTShaderLocations(gl); // Set up the CRT shader locations
		checkWebGLError('After setupCRTShaderLocations');
		GLViewCRT.createCRTVertexBuffer(gl, this.canvas.width, this.canvas.height); // Create the CRT shader vertex buffer for the CRT fragment shader
		checkWebGLError('After createCRTVertexBuffer');
		GLViewCRT.createCRTShaderTexcoordBuffer(gl); // Create the CRT shader texture coordinate buffer for the CRT fragment shader
		checkWebGLError('After createCRTShaderTexcoordBuffer');
		this.setDefaultUniformValues(); // Set the default uniform values for the game and CRT shaders, such as the scale, resolution vector, and texture location and flags (noise, color bleed, scanlines, blur, glow, fringing, etc.)
		checkWebGLError('After setDefaultUniformValues');
		this.createFramebufferAndTexture(); // Create the framebuffer and texture for the post-processing shader, note that this also binds the framebuffer
		checkWebGLError('After createFramebufferAndTexture');
		this.handleResize(); // This is needed to set the viewport size and create the framebuffer and texture
		if (checkWebGLError('After init')) {
			throw Error('Initialization of 2D/3D/CRT shaders failed!');
		}
		this.buildRenderGraph();
	}

	/**
	 * Sets the default uniform values for the game and CRT shaders.
	 * These values include the scale, resolution vector, and texture location for the game shader,
	 * and the scale, resolution vector, and noise, color bleed, blur, glow, and fringing flags for the CRT shader.
	 * @private
	 * @returns void
	 */
	private setDefaultUniformValues(): void {
		const gl = this.glctx;
		GLView2D.setupDefaultUniformValues(gl, 2.0, to_vec2arr(this.offscreenCanvasSize)); // Set the default uniform values for the game shader

		GLView3D.setDefaultUniformValues(gl, 2.0);
		const crtOptions: GLViewCRT.CRTShaderOptions = { applyNoise: this.applyNoise, applyColorBleed: this.applyColorBleed, applyScanlines: this.applyScanlines, applyBlur: this.applyBlur, applyGlow: this.applyGlow, applyFringing: this.applyFringing, blurIntensity: this.blurIntensity, noiseIntensity: this.noiseIntensity, colorBleed: this.colorBleed, glowColor: this.glowColor };

		GLViewCRT.setDefaultUniformValues(gl, to_vec2arr(this.offscreenCanvasSize), crtOptions); // Set the default uniform values for the CRT shader
	}

	/**
	 * Sets up the buffers for the game shader.
	 * This method initializes the vertex, texture coordinate, z-coordinate, and color override buffers for the game shader.
	 * The buffers are created and bound to the respective attributes in the shader program.
	 */
	private setupBuffers(): void {
		const gl = this.glctx;

		GLView2D.setupBuffers(gl);
		GLView3D.setupBuffers3D(gl); // Set up buffers for 3D
	}

	/**
	 * Sets up the textures used in the game.
	 * This method initializes the textures object and creates the atlas texture from the '_atlas' image in the ROM pack.
	 */
	private setupTextures(): void {
		// Initialize the textures object as an empty object.
		// The object will contain all the textures used in the game and are accessed by their keys.
		// Note that this will remain mostly empty if the game uses the default texture atlas.
		const gl = this.glctx;
		this.textures = {
			// Link the atlas texture to the '_atlas' key for easy access
			// The atlas is created from the '_atlas' image in the ROM pack, which is loaded before the GLView is created (during loading of the ROM pack)
			_atlas: glCreateTexture(gl, BaseView.imgassets['_atlas']?._imgbin, undefined, TEXTURE_UNIT_ATLAS),
			// Create the texture with dummy width and height, which will be updated later
			_atlas_dynamic: glCreateTexture(gl, null, { x: 1, y: 1 }, TEXTURE_UNIT_ATLAS_DYNAMIC),
			post_processing_source_texture: null, // This will be created later in createFramebufferAndTexture
		};
	}

	public async setSkyboxImages(ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): Promise<void> {
		GLViewSkybox.setSkyboxImages(ids);
	}

	/**
	 * Setups the WebGL context for rendering the game.
	 * This method sets the blend function, depth function, and enables blending, depth testing, and face culling.
	 * @private
	 * @returns void
	 */
	@catchWebGLError
	private setupGLContext(): void {
		const gl = this.glctx;
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.enable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); // Set unpack alignment to 1 for tightly packed, odd‑width images
	}

	/**
	 * Compiles a WebGL shader from the provided source code.
	 * @param type The type of shader to compile (either gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
	 * @param source The source code of the shader.
	 * @returns The compiled WebGL shader.
	 * @throws An error if the shader fails to compile.
	 */

	/**
	 * Creates a new framebuffer and texture.
	 *
	 * @remarks
	 * This method creates a new texture and framebuffer in the WebGL context.
	 * It also attaches the texture to the framebuffer and sets up a depth buffer.
	 *
	 * @private
	 * @returns void
	 */
	private createFramebufferAndTexture(): void {
		const gl = this.glctx;

		// Delete the old framebuffer and texture if they exist
		if (this.framebuffer) {
			gl.deleteFramebuffer(this.framebuffer);
		}
		if (this.textures['post_processing_source_texture']) {
			gl.deleteTexture(this.textures['post_processing_source_texture']);
		}

		const width = this.offscreenCanvasSize.x;
		const height = this.offscreenCanvasSize.y;

		// Create a new texture
		this.textures['post_processing_source_texture'] = glCreateTexture(gl, undefined, { x: width, y: height }, TEXTURE_UNIT_POST_PROCESSING_SOURCE); // Use TEXTURE8 for the post-processing shader texture

		// Create a new framebuffer
		this.framebuffer = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

		// Attach the texture to the framebuffer
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.textures['post_processing_source_texture'], 0);

		this.depthBuffer = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);

		// Unbind the framebuffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	/**
	 * Overrides the base class method to handle resizing of the canvas and viewport for WebGL rendering.
	 * This method should be called whenever the canvas is resized.
	 */
	override handleResize(this: GLView): void {
		if (this.isRendering) {
			// If a frame is currently being drawn, set the needsResize flag and return
			this.needsResize = true;
			return;
		}

		super.handleResize();
		const gl = this.glctx;
		if (!gl) return;

		GLViewCRT.handleResize(gl, this.canvas.width, this.canvas.height);
		GLView3D.handleResize(gl, this.offscreenCanvasSize.x, this.offscreenCanvasSize.y);
		// Invalidate render graph resources so they are recreated with new size
		this.graphInvalid = true;

		// Clear the needsResize flag
		this.needsResize = false;
	}

	override reset() {
		this.isRendering = false;
		const gl = this.glctx;
		if (!gl) return;

		gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Unbind the framebuffer
		// gl.disable(gl.SCISSOR_TEST);
		gl.colorMask(true, true, true, true); // Enables writing to RGBA color channels. (r,g,b,a) = true => fragments can update the framebuffer's color.
		gl.depthMask(true); // Enables writing to the depth buffer.
		gl.depthFunc(gl.LEQUAL); // Sets the depth function to less than or equal.
		gl.cullFace(gl.BACK); // Sets the culling face to back.
		// gl.enable(gl.DEPTH_TEST);

		gl.viewport(0, 0, this.canvasSize.x, this.canvasSize.y); // Sets the viewport to the full canvas size
		this.clear();
		// GLView2D.reset(gl); // Reset the 2D view
		GLView3D.reset(gl); // Reset the 3D view
		// GLViewParticles.reset(gl); // Reset the particles view
		// GLViewSkybox.reset(gl); // Reset the skybox view
		// GLViewCRT.reset(gl); // Reset the CRT shader
	}

	override drawgame(clearCanvas: boolean = true): void {
		if (!renderGate.ready) {
			console.debug(`renderGate block: ${renderGate.liveCount}`);
			return; // Skip drawing until renderGate is released
		}

		const token = renderGate.begin({ blocking: true, tag: 'frame' });
		try {
			this.isRendering = true;
			this.executeRenderGraph(clearCanvas);


			// Check if a resize was requested while rendering
			if (this.needsResize) {
				this.handleResize();
			}
		} finally {
			this.isRendering = false;
			checkWebGLError('After CRT post-process');
			renderGate.end(token);
		}
	}

	private buildRenderGraph(): void {
		// Ensure a persistent backend instance exists even before the render graph is (re)built.
		if (!this.backend) this.backend = new WebGLBackend(this.glctx);
		this.renderGraph = new RenderGraphRuntime(this.backend);
		const lightingSystem = new LightingSystem(this.glctx);
		this.rgColor = null;
		this.rgDepth = null;
		// Reusable scratch vectors (avoid per-frame allocations in passes)
		const particleCamRight = new Float32Array(3);
		const particleCamUp = new Float32Array(3);
		// Pass: create / clear targets
		this.renderGraph.addPass({
			name: 'Clear',
			setup: (io) => {
				// Create logical resources & declare write with clear options so runtime performs clear automatically.
				this.rgColor = io.createTex({ width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y, name: 'FrameColor' });
				this.rgDepth = io.createTex({ width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
				if (this.rgColor) io.writeTex(this.rgColor, { clearColor: [0, 0, 0, 1] });
				if (this.rgDepth) io.writeTex(this.rgDepth, { clearDepth: 1.0 });
				if (this.rgColor) io.exportToBackbuffer(this.rgColor);
				return null;
			},
			execute: () => { /* clear handled by runtime */ }
		});
		// FrameSharedState pass: gather per-frame view & lighting
		this.renderGraph.addPass({
			name: 'FrameSharedState',
			// Side-effect aggregation; force execution (alwaysExecute) while migration in progress.
			alwaysExecute: true,
			setup: () => { return null; }, // no resource deps so it schedules early after Clear
			execute: (ctx) => {
				const cam = $.model.activeCamera3D; if (!cam) return;
				const viewState = { camPos: cam.position, viewProj: cam.viewProjection, skyboxView: cam.skyboxView, proj: cam.projection };
				// Use type guard to ensure only AmbientLight accepted
				const maybeAmbient = $.model.ambientLight?.light;
				const lighting = lightingSystem.update(isAmbientLight(maybeAmbient) ? maybeAmbient : null);
				ctx.backend.setPipelineState?.('__frame_shared__', { view: viewState, lighting });
			}
		});
		// Skybox pass
		this.renderGraph.addPass({
			name: 'Skybox',
			consumes: [RGCommandKind.Skybox],
			setup: (io) => {
				// Overlay writer: declare writes to same targets (no clear) to chain multi-writer ordering
				if (this.rgColor) io.writeTex(this.rgColor);
				if (this.rgDepth) io.writeTex(this.rgDepth);
				return { width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y };
			},
			execute: (ctx, frame, data: { width: number; height: number }) => {
				if (!this.rgColor || !this.rgDepth) return;
				if (!frame.drawCommands || frame.drawCommands.length === 0) return; // filtered out
				const cam = $.model.activeCamera3D;
				if (!cam) return;
				// Acquire skybox texture once here; pipeline won't re-fetch.
				const tex = $.texmanager.getTexture(GLViewSkybox.skyboxKey) as WebGLTexture | undefined;
				if (!tex) return;
				ctx.backend.setPipelineState?.(PipelineId.Skybox, { view: cam.skyboxView, proj: cam.projection, tex, width: data.width, height: data.height });
				const fbo = ctx.getFBO(this.rgColor, this.rgDepth);
				ctx.backend.executePipeline?.(PipelineId.Skybox, fbo);
			}
		});
		// Mesh pass
		this.renderGraph.addPass({
			name: 'Meshes',
			consumes: [RGCommandKind.MeshBatch],
			setup: (io) => {
				if (this.rgColor) io.writeTex(this.rgColor);
				if (this.rgDepth) io.writeTex(this.rgDepth);
				return { width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y };
			},
			execute: (ctx, frame, data: { width: number; height: number }) => {
				if (!this.rgColor || !this.rgDepth) return;
				// Skip if no meshes enqueued this frame.
				if (GLView3D.meshesToDraw?.length === 0) return;
				const fbo = ctx.getFBO(this.rgColor, this.rgDepth);
				const cam = $.model.activeCamera3D;
				const fogState = {
					fogColor: Atmosphere.fogColor as [number, number, number],
					fogDensity: (() => { const p = Atmosphere.progressFactor; const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0; return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim; })(),
					enableFog: Atmosphere.enableFog, fogMode: Atmosphere.fogMode,
					enableHeightFog: Atmosphere.enableHeightFog, heightFogStart: Atmosphere.heightFogStart, heightFogEnd: Atmosphere.heightFogEnd,
					heightLowColor: Atmosphere.heightLowColor as [number, number, number], heightHighColor: Atmosphere.heightHighColor as [number, number, number],
					heightMin: Atmosphere.heightMin, heightMax: Atmosphere.heightMax, enableHeightGradient: Atmosphere.enableHeightGradient,
				};
				// Build consolidated per-frame view state (shared across pipelines if needed)
				const viewState = { camPos: cam.position, viewProj: cam.viewProjection };
				const frameShared = ctx.backend.getPipelineState?.('__frame_shared__') as { view: any; lighting: any } | undefined;
				ctx.backend.setPipelineState?.(PipelineId.MeshBatch, { width: data.width, height: data.height, view: viewState, fog: fogState, lighting: frameShared?.lighting });
				ctx.backend.executePipeline?.(PipelineId.MeshBatch, fbo);
			}
		});
		// Particle pass
		this.renderGraph.addPass({
			name: 'Particles',
			consumes: [RGCommandKind.ParticleBatch],
			setup: (io) => {
				if (this.rgColor) io.writeTex(this.rgColor);
				if (this.rgDepth) io.writeTex(this.rgDepth);
				return { width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y };
			},
			execute: (ctx, frame, data: { width: number; height: number }) => {
				if (!this.rgColor || !this.rgDepth) return;
				if (GLViewParticles.particlesToDraw?.length === 0) return;
				const fbo = ctx.getFBO(this.rgColor, this.rgDepth);
				const activeCamera = $.model.activeCamera3D;
				if (activeCamera) {
					// Extract camera right/up vectors from view matrix for billboard orientation (reuse scratch arrays)
					M4.viewRightUpInto(activeCamera.view, particleCamRight, particleCamUp);
					ctx.backend.setPipelineState?.(PipelineId.Particles, { width: data.width, height: data.height, viewProj: activeCamera.viewProjection, camRight: particleCamRight, camUp: particleCamUp });
				}
				ctx.backend.executePipeline?.(PipelineId.Particles, fbo);
			}
		});
		// Sprite pass
		this.renderGraph.addPass({
			name: 'Sprites2D',
			consumes: [RGCommandKind.SpriteBatch],
			setup: (io) => {
				if (this.rgColor) io.writeTex(this.rgColor);
				if (this.rgDepth) io.writeTex(this.rgDepth);
				return { width: this.offscreenCanvasSize.x, height: this.offscreenCanvasSize.y };
			},
			execute: (ctx, frame, data: { width: number; height: number }) => {
				if (!this.rgColor || !this.rgDepth) return;
				// Sprites are always drawn; no additional guard needed.
				const fbo = ctx.getFBO(this.rgColor, this.rgDepth);
				ctx.backend.setPipelineState?.(PipelineId.Sprites, { width: data.width, height: data.height });
				ctx.backend.executePipeline?.(PipelineId.Sprites, fbo);
			}
		});
		// Presentation (CRT post-process) pass reading exported color
		this.renderGraph.addPass({
			name: 'Present',
			setup: (io) => { if (this.rgColor) io.readTex(this.rgColor); return null; },
			execute: (ctx) => {
				if (!this.rgColor) return;
				const glTex = ctx.getTex(this.rgColor);
				if (!glTex) return;
				// Bind color texture to post-processing sampler unit
				this.activeTexUnit = TEXTURE_UNIT_POST_PROCESSING_SOURCE;
				this.bind2DTex(glTex);
				// CRT expects canvas-sized viewport (already set by drawbase)
				GLViewCRT.applyCrtPostProcess(this.glctx, this.canvas.width, this.canvas.height);
				glSwitchProgram(this.glctx, GLView2D.spriteShaderProgram);
			}
		});
		this.graphInvalid = false;
	}

	private executeRenderGraph(clearCanvas: boolean): void {
		this.lastFrameStart = performance.now();
		// Build frame data snapshot and dynamic draw command list via helper
		const _frame: FrameData = buildFrameData(this);
		_frame.drawCommands = buildDrawCommands(this);
		// drawbase sets up base state (clear on main canvas) if requested
		this.drawbase(clearCanvas);
		this.renderGraph!.execute(_frame);
		if (this.logPassStats) this.updatePassStatsOverlay(performance.now() - this.lastFrameStart);
	}

	private setViewportOffscreen(): void {
		const gl = this.glctx;
		gl.viewport(0, 0, this.offscreenCanvasSize.x, this.offscreenCanvasSize.y);
	}

	public setPassStatsLogging(enabled: boolean): void {
		if (enabled === this.logPassStats) return;
		this.logPassStats = enabled;
		if (enabled) {
			if (!this.passStatsOverlay) {
				const div = document.createElement('div');
				this.applyOverlayTheme(div, this.overlayThemeIndex);
				div.textContent = 'RG stats...';
				document.body.appendChild(div);
				this.passStatsOverlay = div;
			}
			if (!this.overlayHotkeyRegistered) {
				window.addEventListener('keydown', (e) => {
					if (e.key === 'F8' && !e.shiftKey) {
						this.setPassStatsLogging(!this.logPassStats);
					} else if (e.key === 'F8' && e.shiftKey) {
						this.overlayThemeIndex = (this.overlayThemeIndex + 1) % 2; // two themes for now
						if (this.passStatsOverlay) this.applyOverlayTheme(this.passStatsOverlay, this.overlayThemeIndex);
					}
				});
				this.overlayHotkeyRegistered = true;
			}
		} else {
			if (this.passStatsOverlay) {
				this.passStatsOverlay.remove();
				this.passStatsOverlay = null;
			}
			this.passStatsTotals = {};
			this.frameTimes = [];
		}
	}

	private updatePassStatsOverlay(frameMs: number): void {
		const stats = this.renderGraph?.getPassStats();
		if (!stats) return;
		for (const s of stats) {
			let rec = this.passStatsTotals[s.name];
			if (!rec) rec = this.passStatsTotals[s.name] = { frames: 0, total: 0 };
			rec.frames++;
			rec.total += s.ms;
		}
		// Rolling window frame times
		this.frameTimes.push(frameMs);
		if (this.frameTimes.length > this.frameTimeBufferSize) this.frameTimes.shift();
		let sum = 0, min = Infinity, max = -Infinity;
		for (let i = 0; i < this.frameTimes.length; i++) {
			const v = this.frameTimes[i];
			sum += v; if (v < min) min = v; if (v > max) max = v;
		}
		const avgFrame = sum / this.frameTimes.length;
		const currentFps = 1000 / frameMs;
		const avgFps = 1000 / avgFrame;
		if (this.passStatsOverlay) {
			const lines: string[] = [];
			lines.push(`FPS ${currentFps.toFixed(1)} (avg ${avgFps.toFixed(1)}) frame ${frameMs.toFixed(2)}ms avg ${avgFrame.toFixed(2)} min ${min.toFixed(2)} max ${max.toFixed(2)}`);
			for (const s of stats) {
				const avg = this.passStatsTotals[s.name];
				const avgMs = avg.total / avg.frames;
				const warn = s.ms > 4 ? '!' : ' ';
				lines.push(`${warn}${s.name.padEnd(8)} ${s.ms.toFixed(2)}ms (avg ${avgMs.toFixed(2)})`);
			}
			this.passStatsOverlay.textContent = lines.join('\n');
		}
	}

	private applyOverlayTheme(div: HTMLDivElement, themeIndex: number): void {
		div.style.position = 'absolute';
		div.style.top = '0';
		div.style.right = '0';
		div.style.font = '11px/1.2 monospace';
		div.style.whiteSpace = 'pre';
		div.style.pointerEvents = 'none';
		div.style.zIndex = '9999';
		if (themeIndex === 0) {
			div.style.background = 'rgba(0,0,0,0.55)';
			div.style.color = '#8f8';
			div.style.textShadow = '0 0 2px #0f0';
			div.style.border = '1px solid #0a0';
		} else {
			div.style.background = 'rgba(16,16,40,0.70)';
			div.style.color = '#e0e0ff';
			div.style.textShadow = '0 0 3px #6af';
			div.style.border = '1px solid #385';
		}
		div.style.padding = '4px 6px';
	}

	/**
	 * Overrides the base class method to clear the WebGL canvas.
	 */
	override clear(): void {
		const gl = this.glctx;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.clearDepth(1.0);

		// Clear the texture
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	/**
	 * Draws an image on the canvas using WebGL.
	 * @param options An object containing the image's position, size, and other options.
	 * @throws An error if the image metadata cannot be found.
	 */
	override drawImg(options: DrawImgOptions): void {
		GLView2D.drawImg(this, options);
	}

	/**
	 * Draws a rectangle on the canvas by drawing the borders of the rectangle using the white pixel image with the desired color.
	 * @param options
	 */
	override drawRectangle(options: DrawRectOptions): void {
		GLView2D.drawRectangle(this, options);
	}

	/**
	 * Fills a rectangle on the canvas by drawing a stretched white pixel image with the desired color.
	 * @param options
	 */
	override fillRectangle(options: DrawRectOptions): void {
		GLView2D.fillRectangle(this, options);
	}

	/**
	 * Draws the outline of a polygon by drawing lines between its vertices using the white pixel image.
	 * @param coords Array of {x, y, z} points (polygon vertices, in order)
	 * @param color Color to use for the outline
	 * @param thickness Line thickness in pixels (default 1)
	 */
	public override drawPolygon(coords: Polygon, z: number, color: Color, thickness: number = 1): void {
		GLView2D.drawPolygon(this, coords, z, color, thickness);
	}

	public override drawMesh(options: DrawMeshOptions): void {
		GLView3D.meshesToDraw.push(options);
	}
	public override setSkybox(images: SkyboxImageIds): void {
		this.setSkyboxImages(images);
	}
	public override getPointLight(id: Identifier): PointLight | undefined {
		return GLView3D.getPointLight(id);
	}
	public override setPointLight(id: Identifier, light: PointLight): void {
		GLView3D.addPointLight(this.glctx, id, light);
	}
	public override removePointLight(id: Identifier): void {
		GLView3D.removePointLight(this.glctx, id);
	}
	public override addDirectionalLight(id: Identifier, light: DirectionalLight): void {
		GLView3D.addDirectionalLight(this.glctx, id, light);
	}
	public override removeDirectionalLight(id: Identifier): void {
		GLView3D.removeDirectionalLight(this.glctx, id);
	}

	public override setAmbientLight(light: AmbientLight): void {
		GLView3D.setAmbientLight(this.glctx, light);
	}

	public override clearLights(): void {
		GLView3D.clearLights(this.glctx);
	}

	private _dynamicAtlasIndex: number | null = null;

	public get dynamicAtlas(): number | null {
		return this._dynamicAtlasIndex;
	}

	/**
	 * Sets the dynamic atlas texture for the GLView.
	 * This allows for dynamic textures to be used in the game, such as textures that are generated at runtime.
	 * @param index The index of the dynamic atlas texture to set.
	 */
	public set dynamicAtlas(index: number) {
		if (this._dynamicAtlasIndex === index) {
			// No change in the dynamic atlas index, no need to update
			return;
		}

		// Remove the texture from the textures map and free up memory
		if (this.textures['_atlas_dynamic']) {
			this.glctx.deleteTexture(this.textures['_atlas_dynamic']);
			delete this.textures['_atlas_dynamic'];
		}

		this._dynamicAtlasIndex = index ?? null;
		if (index === null) {
			// If the index is null, we reset the dynamic atlas texture and ensure it is deleted from memory
			this.glctx.activeTexture(this.glctx.TEXTURE1);
			this.glctx.bindTexture(this.glctx.TEXTURE_2D, null);
			return;
		}

		const atlasName = generateAtlasName(index);
		const atlasImage = BaseView.imgassets[atlasName]?._imgbin; // Atlas image should be in _imgbin as it should already be loaded
		if (!atlasImage) {
			console.error(`Atlas image with name '${atlasName}' not found!`);
			return;
		}

		const gl = this.glctx;
		// Create the dynamic atlas texture
		this.textures['_atlas_dynamic'] = glCreateTexture(gl, atlasImage, { x: atlasImage.width, y: atlasImage.height }, 1);

		// Bind once so subsequent sprite draws use the updated atlas (already uploaded above)
		$.viewAs<GLView>().bind2DTex(this.textures['_atlas_dynamic']);
	}

	public get skyboxFaceIds(): SkyboxImageIds | undefined {
		return GLViewSkybox.skyboxFaceIds;
	}
}
