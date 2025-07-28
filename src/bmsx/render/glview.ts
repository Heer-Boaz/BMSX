import { multiply_vec, new_vec2, new_vec3 } from '../core/game';
import type { ImgMeta, Polygon, Size, vec2, vec3arr } from '../rompack/rompack';

import { createBuffer as glCreateBuffer, createTexture as glCreateTexture, loadShader as glLoadShader, setupAttributeFloat as glSetupAttributeFloat, setupAttributeInt as glSetupAttributeInt, switchProgram as glSwitchProgram, updateBuffer as glUpdateBuffer } from './glutils';
import { ATLAS_ID_ATTRIBUTE_SIZE, ATLAS_ID_BUFFER_OFFSET_MULTIPLIER, ATLAS_ID_COMPONENTS, ATLAS_ID_SIZE, COLOR_OVERRIDE_ATTRIBUTE_SIZE, COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER, COLOR_OVERRIDE_COMPONENTS, COLOR_OVERRIDE_SIZE, DEFAULT_VERTEX_COLOR, DEFAULT_ZCOORD, MAX_SPRITES, POSITION_COMPONENTS, RESOLUTION_VECTOR_SIZE, SPRITE_DRAW_OFFSET, TEXCOORD_COMPONENTS, TEXTURECOORD_ATTRIBUTE_SIZE, TEXTURECOORDS_SIZE, VERTEX_ATTRIBUTE_SIZE, VERTEX_BUFFER_OFFSET_MULTIPLIER, VERTEX_COLOR_COLORIZED_BLUE, VERTEX_COLOR_COLORIZED_GREEN, VERTEX_COLOR_COLORIZED_RED, VERTEXCOORDS_SIZE, VERTICES_PER_SPRITE, ZCOORD_ATTRIBUTE_SIZE, ZCOORD_BUFFER_OFFSET_MULTIPLIER, ZCOORD_COMPONENTS, ZCOORD_MAX, ZCOORDS_SIZE } from './glview.constants';
import { catchWebGLError } from './glview.helpers';

import gameShaderCode from './shaders/2d/2d.frag.glsl';
import vertexShaderCode from './shaders/2d/2d.text.glsl';
import crtShaderCode from './shaders/crt.frag.glsl';

import { bvec } from './2d/vertexutils2d';
import { BaseView, Color, DrawImgOptions, DrawRectOptions } from './view';
import * as GLView2D from './2d/glview.2d';

import * as GLView3D from './3d/glview.3d';
import { Material } from './3d/material';
import { ShadowMap } from './3d/shadowmap';

export { DEFAULT_VERTEX_COLOR, VERTEX_COLOR_COLORIZED_BLUE, VERTEX_COLOR_COLORIZED_GREEN, VERTEX_COLOR_COLORIZED_RED, ZCOORD_MAX };

type texturetype = '_atlas' | '_atlas_dynamic' | 'post_processing_source_texture';

/**
 * Represents a view that renders graphics using WebGL.
 */
export abstract class GLView extends BaseView {
	/**
	 * The WebGL rendering context used for rendering the game.
	 */
	public glctx: WebGL2RenderingContext; // TODO: Remove public access, which is only used for catching WebGL errors
	private textures: { [key in texturetype]: WebGLTexture; };
	private gameShaderProgram: WebGLProgram;
	private vertexLocation: number;
	private texcoordLocation: number;
	private zcoordLocation: number;
	private color_overrideLocation: number;
	private atlas_idLocation: number;
	private resolutionLocation: WebGLUniformLocation;
	private texture0Location: WebGLUniformLocation;
	private texture1Location: WebGLUniformLocation;
	private vertexBuffer: WebGLBuffer;
	private texcoordBuffer: WebGLBuffer;
	private zBuffer: WebGLBuffer;
	private CRTShaderVertexBuffer: WebGLBuffer;
	private CRTShaderTexcoordBuffer: WebGLBuffer;
	private depthBuffer: WebGLBuffer;
	private color_overrideBuffer: WebGLBuffer;
	private atlas_idBuffer: WebGLBuffer;
	private readonly vertex_shader_data = {
		resolutionVector: new Float32Array(RESOLUTION_VECTOR_SIZE),
		vertexcoords: GLView.getTextureCoordinates(),
		texcoords: new Float32Array(TEXTURECOORDS_SIZE * MAX_SPRITES),
		zcoords: new Float32Array(ZCOORDS_SIZE * MAX_SPRITES),
		color_override: new Float32Array(COLOR_OVERRIDE_SIZE * MAX_SPRITES),
		atlas_id: new Uint8Array(ATLAS_ID_SIZE * MAX_SPRITES),
	}

	private CRTShaderTexcoordLocation: GLint;
	private CRTShaderResolutionLocation: WebGLUniformLocation;
	private CRTShaderTimeLocation: WebGLUniformLocation;
	private CRTShaderRandomLocation: WebGLUniformLocation;
	private CRTShaderVertexLocation: GLint;
	private CRTShaderApplyNoiseLocation: WebGLUniformLocation;
	private CRTShaderApplyColorBleedLocation: WebGLUniformLocation;
	private CRTShaderApplyScanlinesLocation: WebGLUniformLocation;
	private CRTShaderApplyBlurLocation: WebGLUniformLocation;
	private CRTShaderApplyGlowLocation: WebGLUniformLocation;
	private CRTShaderApplyFringingLocation: WebGLUniformLocation;
	private CRTShaderNoiseIntensityLocation: WebGLUniformLocation;
	private CRTShaderColorBleedLocation: WebGLUniformLocation;
	private CRTShaderBlurIntensityLocation: WebGLUniformLocation;
	private CRTShaderGlowColorLocation: WebGLUniformLocation;
	private CRTFragmentShaderTextureLocation: WebGLUniformLocation;

	private CRTShaderProgram: WebGLProgram;
	public framebuffer: WebGLFramebuffer;
	private isRendering: boolean = false;
	private needsResize: boolean = false;


	public static readonly vertexShaderCode: string = vertexShaderCode;
	public static readonly fragmentShaderTextureCode: string = gameShaderCode;
	public static readonly fragmentShaderCRTCode: string = crtShaderCode;


	private _applyNoise: boolean = true;
	private _applyColorBleed: boolean = true;
	private _applyScanlines: boolean = true;
	private _applyBlur: boolean = true;
	private _applyGlow: boolean = true;
	private _applyFringing: boolean = true;
	private _noiseIntensity: number = 0.2;
	private _colorBleed: vec3arr = [0.02, 0.0, 0.0];
	private _blurIntensity: number = 0.6;
	private _glowColor: vec3arr = [0.05, 0.02, 0.02];

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply noise.
	 */
	public get applyNoise(): boolean {
		return this._applyNoise;
	}

	public set applyNoise(value: boolean) {
		this._applyNoise = value;
		this.glctx.uniform1i(this.CRTShaderApplyNoiseLocation, value ? 1 : 0);
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply color bleed.
	 */
	public get applyColorBleed(): boolean {
		return this._applyColorBleed;
	}

	public set applyColorBleed(value: boolean) {
		this._applyColorBleed = value;
		this.glctx.uniform1i(this.CRTShaderApplyColorBleedLocation, value ? 1 : 0);
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply scanlines.
	 */
	public get applyScanlines(): boolean {
		return this._applyScanlines;
	}

	public set applyScanlines(value: boolean) {
		this._applyScanlines = value;
		this.glctx.uniform1i(this.CRTShaderApplyScanlinesLocation, value ? 1 : 0);
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply blur.
	 */
	public get applyBlur(): boolean {
		return this._applyBlur;
	}

	public set applyBlur(value: boolean) {
		this._applyBlur = value;
		this.glctx.uniform1i(this.CRTShaderApplyBlurLocation, value ? 1 : 0);
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply glow.
	 */
	public get applyGlow(): boolean {
		return this._applyGlow;
	}

	public set applyGlow(value: boolean) {
		this._applyGlow = value;
		this.glctx.uniform1i(this.CRTShaderApplyGlowLocation, value ? 1 : 0);
	}

	/**
	 * Gets or sets a value indicating whether the CRT shader should apply fringing.
	 */
	public get applyFringing(): boolean {
		return this._applyFringing;
	}

	public set applyFringing(value: boolean) {
		this._applyFringing = value;
		this.glctx.uniform1i(this.CRTShaderApplyFringingLocation, value ? 1 : 0);
	}

	public get noiseIntensity(): number {
		return this._noiseIntensity;
	}

	public set noiseIntensity(value: number) {
		this._noiseIntensity = value;
		this.glctx.uniform1f(this.CRTShaderNoiseIntensityLocation, value);
	}

	public get colorBleed(): vec3arr {
		return this._colorBleed;
	}

	public set colorBleed(value: vec3arr) {
		this._colorBleed = value;
		this.glctx.uniform3fv(this.CRTShaderColorBleedLocation, new Float32Array(value));
	}

	public get blurIntensity(): number {
		return this._blurIntensity;
	}

	public set blurIntensity(value: number) {
		this._blurIntensity = value;
		this.glctx.uniform1f(this.CRTShaderBlurIntensityLocation, value);
	}

	public get glowColor(): vec3arr {
		return this._glowColor;
	}

	public set glowColor(value: vec3arr) {
		this._glowColor = value;
		this.glctx.uniform3fv(this.CRTShaderGlowColorLocation, new Float32Array(value));
	}

	private gameShaderScaleLocation: WebGLUniformLocation;
	private CRTVertexShaderScaleLocation: WebGLUniformLocation;
	public offscreenCanvasSize: vec2;
	CRTFragmentShaderScaleLocation: WebGLUniformLocation;

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
		GLView3D.init(this.glctx, this, this.offscreenCanvasSize);
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
		this.setupGLContext(); // Set up the WebGL context
		this.createGameShaderPrograms(); // Create the game shader programs
		GLView3D.createGameShaderPrograms3D(); // Create 3D shader program
		GLView3D.createSkyboxProgram();
		this.setupVertexShaderLocations(); // Set up the vertex shader locations for the game shader program
		GLView3D.setupVertexShaderLocations3D(); // Set up the vertex shader locations for the 3D shader
		GLView3D.setupSkyboxLocations();
		this.setupBuffers(); // Set up the buffers for the game shader
		this.setupGameShaderLocations(); // Set up the game shader locations
		this.setupGameShader3DLocations(); // Set up locations for 3D shader
		this.setupTextures(); // Set up the textures used by the shaders (such as the atlas texture and the post-processing shader texture)
		this.createCRTShaderPrograms(); // Create the CRT shader programs
		this.setupCRTShaderLocations(); // Set up the CRT shader locations
		this.createCRTVertexBuffer(); // Create the CRT shader vertex buffer for the CRT fragment shader
		this.createCRTShaderTexcoordBuffer(); // Create the CRT shader texture coordinate buffer for the CRT fragment shader
		this.setDefaultUniformValues(); // Set the default uniform values for the game and CRT shaders, such as the scale, resolution vector, and texture location and flags (noise, color bleed, scanlines, blur, glow, fringing, etc.)
		this.createFramebufferAndTexture(); // Create the framebuffer and texture for the post-processing shader, note that this also binds the framebuffer
		this.handleResize(); // This is needed to set the viewport size and create the framebuffer and texture
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
		gl.useProgram(this.gameShaderProgram);
		gl.uniform1f(this.gameShaderScaleLocation, 2.0);
		this.vertex_shader_data.resolutionVector.set([this.offscreenCanvasSize.x, this.offscreenCanvasSize.y]); // Set the resolution vector for the game shader, which uses a different resolution than the CRT shader
		gl.uniform2fv(this.resolutionLocation, this.vertex_shader_data.resolutionVector);
		gl.uniform1i(this.texture0Location, 0); // Texture unit 0 is typically used for the main texture
		gl.uniform1i(this.texture1Location, 1); // Texture unit 1 can be used for additional textures or effects

		GLView3D.setDefaultUniformValues();

		gl.useProgram(this.CRTShaderProgram);
		gl.uniform1f(this.CRTVertexShaderScaleLocation, 1.0);
		gl.uniform1f(this.CRTFragmentShaderScaleLocation, 1.0);
		gl.uniform1i(this.CRTShaderApplyNoiseLocation, this.applyNoise ? 1 : 0);
		gl.uniform1i(this.CRTShaderApplyColorBleedLocation, this.applyColorBleed ? 1 : 0);
		gl.uniform1i(this.CRTShaderApplyScanlinesLocation, this.applyScanlines ? 1 : 0);
		gl.uniform1i(this.CRTShaderApplyBlurLocation, this.applyBlur ? 1 : 0);
		gl.uniform1i(this.CRTShaderApplyGlowLocation, this.applyGlow ? 1 : 0);
		gl.uniform1i(this.CRTShaderApplyFringingLocation, this.applyFringing ? 1 : 0);
		gl.uniform1f(this.CRTShaderNoiseIntensityLocation, this._noiseIntensity);
		gl.uniform3fv(this.CRTShaderColorBleedLocation, new Float32Array(this._colorBleed));
		gl.uniform1f(this.CRTShaderBlurIntensityLocation, this._blurIntensity);
		gl.uniform3fv(this.CRTShaderGlowColorLocation, new Float32Array(this._glowColor));
		const POST_UNIT = gl.TEXTURE8; // Use a texture unit that is not used by the game shader
		const CRTFRAGMENT_SHADER_TEXTURE_UNIT_INDEX = POST_UNIT - gl.TEXTURE0; // Calculate the texture unit index for the CRT fragment shader
		gl.uniform1i(this.CRTFragmentShaderTextureLocation, CRTFRAGMENT_SHADER_TEXTURE_UNIT_INDEX); // Set the texture unit for the post-processing shader texture. Note that the uniform expects an index instead of a WebGLTexture object, so we subtract gl.TEXTURE0 to get the index of the texture unit.
		// Note that the resolution vector is set in the handleResize method for the CRT shader
	}

	@catchWebGLError
	/**
	 * Creates the CRT shader vertex buffer for the full-screen quad used in the CRT fragment shader.
	 */
	private createCRTVertexBuffer(): void {
		const gl = this.glctx;
		// Define the vertex positions for a full-screen quad (in clip space)
		const vertices = new Float32Array([
			-1.0, -1.0, // bottom left
			1.0, -1.0, // bottom right
			-1.0, 1.0, // top left
			1.0, -1.0, // bottom right
			1.0, 1.0, // top right
			-1.0, 1.0  // top left
		]);

		// Create a new buffer and bind the vertex position data to it
		bvec.set(vertices, 0, 0, 0, this.canvas.width, this.canvas.height, 1, 1);
		this.CRTShaderVertexBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.CRTShaderVertexBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
	}

	@catchWebGLError
	/**
	 * Creates the CRT shader texture coordinate buffer for the full-screen quad used in the CRT fragment shader.
	 */
	private createCRTShaderTexcoordBuffer(): void {
		const gl = this.glctx;
		// Define the texture coordinates for a full-screen quad
		const texcoords = new Float32Array([
			0.0, 1.0,
			1.0, 1.0,
			0.0, 0.0,
			0.0, 0.0,
			1.0, 1.0,
			1.0, 0.0,
		]);

		// Create a new buffer and bind the texture coordinate data to it
		this.CRTShaderTexcoordBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.CRTShaderTexcoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, texcoords, gl.STATIC_DRAW);
	}

	@catchWebGLError
	/**
	 * Creates the CRT shader programs.
	 *
	 * @remarks
	 * This method creates the additional GLSL program for the CRT shader effect. It loads the vertex and fragment shaders,
	 * attaches them to the program, and links the program. If the program fails to link, an error is thrown.
	 */
	private createCRTShaderPrograms(): void {
		const gl = this.glctx;
		const program = gl.createProgram();
		if (!program) throw Error(`Failed to create the CRT Shader GLSL program! Aborting as we cannot create the GLView for the game!`);
		this.CRTShaderProgram = program;

		const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, GLView.vertexShaderCode);
		const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, GLView.fragmentShaderCRTCode);

		gl.attachShader(program, vertShader);
		gl.attachShader(program, fragShader);
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw Error(`Unable to initialize the crt shader shader program: ${gl.getProgramInfoLog(program)}.`);
		}
	}

	@catchWebGLError
	/**
	 * Sets up the CRT shader locations.
	 * This method initializes the necessary shader locations for the crt shader program used in the GL view.
	 * It sets the resolution vector, retrieves the attribute and uniform locations,
	 * and enables the position and texcoord attributes for the shader.
	 */
	private setupCRTShaderLocations(): void {
		const gl = this.glctx;
		const locations = {
			vertex: gl.getAttribLocation(this.CRTShaderProgram, 'a_position'),
			texturecoord: gl.getAttribLocation(this.CRTShaderProgram, 'a_texcoord'),
			resolution: gl.getUniformLocation(this.CRTShaderProgram, 'u_resolution'),
			random: gl.getUniformLocation(this.CRTShaderProgram, 'u_random'),
			time: gl.getUniformLocation(this.CRTShaderProgram, 'u_time')
		};
		this.CRTShaderVertexLocation = locations.vertex;
		this.CRTShaderTexcoordLocation = locations.texturecoord;
		this.CRTShaderResolutionLocation = locations.resolution;
		this.CRTShaderTimeLocation = locations.time;
		this.CRTShaderRandomLocation = locations.random;
		this.CRTShaderApplyNoiseLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyNoise');
		this.CRTShaderApplyColorBleedLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyColorBleed');
		this.CRTShaderApplyScanlinesLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyScanlines');
		this.CRTShaderApplyBlurLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyBlur');
		this.CRTShaderApplyGlowLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyGlow');
		this.CRTShaderApplyFringingLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_applyFringing');
		this.CRTShaderNoiseIntensityLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_noiseIntensity');
		this.CRTShaderColorBleedLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_colorBleed');
		this.CRTShaderBlurIntensityLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_blurIntensity');
		this.CRTShaderGlowColorLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_glowColor');
		this.CRTVertexShaderScaleLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_scale');
		this.CRTFragmentShaderScaleLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_fragscale');
		this.CRTFragmentShaderTextureLocation = gl.getUniformLocation(this.CRTShaderProgram, 'u_texture');

		// Enable the position attribute for the shader
		gl.enableVertexAttribArray(this.CRTShaderVertexLocation);

		// Enable the texcoord attribute for the shader
		gl.enableVertexAttribArray(this.CRTShaderTexcoordLocation);
	}

	/**
	 * Sets up the buffers for the game shader.
	 * This method initializes the vertex, texture coordinate, z-coordinate, and color override buffers for the game shader.
	 * The buffers are created and bound to the respective attributes in the shader program.
	 */
	@catchWebGLError
	private setupBuffers(): void {
		const gl = this.glctx;
		const buffers = {
			vertex: glCreateBuffer(gl, this.vertex_shader_data.vertexcoords),
			texturecoord: glCreateBuffer(gl, this.vertex_shader_data.texcoords),
			z: glCreateBuffer(gl, this.vertex_shader_data.zcoords),
			color_override: glCreateBuffer(gl, this.vertex_shader_data.color_override),
			atlas_id: glCreateBuffer(gl, this.vertex_shader_data.atlas_id),
		};

		this.vertexBuffer = buffers.vertex;
		this.texcoordBuffer = buffers.texturecoord;
		this.zBuffer = buffers.z;
		this.color_overrideBuffer = buffers.color_override;
		this.atlas_idBuffer = buffers.atlas_id;

		GLView3D.setupBuffers3D(); // Set up buffers for 3D
		GLView3D.createSkyboxBuffer();

	}

	@catchWebGLError
	private drawSkybox(): void {
		GLView3D.drawSkybox();
	}

	/**
	 * Sets up the attribute locations for the game shader program.
	 * This method initializes the attribute locations for the vertex, texture coordinate, z-coordinate, and color override attributes.
	 */
	@catchWebGLError
	private setupGameShaderLocations(): void {
		const gl = this.glctx;
		glSwitchProgram(gl, this.gameShaderProgram);

		glSetupAttributeFloat(gl, this.vertexBuffer, this.vertexLocation, VERTEX_ATTRIBUTE_SIZE);
		glSetupAttributeFloat(gl, this.texcoordBuffer, this.texcoordLocation, TEXTURECOORD_ATTRIBUTE_SIZE);
		glSetupAttributeFloat(gl, this.zBuffer, this.zcoordLocation, ZCOORD_ATTRIBUTE_SIZE);
		glSetupAttributeFloat(gl, this.color_overrideBuffer, this.color_overrideLocation, COLOR_OVERRIDE_ATTRIBUTE_SIZE);
		glSetupAttributeInt(gl, this.atlas_idBuffer, this.atlas_idLocation, ATLAS_ID_ATTRIBUTE_SIZE);
	}

	@catchWebGLError
	private setupGameShader3DLocations(): void {
		GLView3D.setupGameShader3DLocations();
	}

	/**
	 * Sets up the textures used in the game.
	 * This method initializes the textures object and creates the atlas texture from the '_atlas' image in the ROM pack.
	 */
	@catchWebGLError
	private setupTextures(): void {
		// Initialize the textures object as an empty object.
		// The object will contain all the textures used in the game and are accessed by their keys.
		// Note that this will remain mostly empty if the game uses the default texture atlas.
		const gl = this.glctx;
		this.textures = {
			// Link the atlas texture to the '_atlas' key for easy access
			// The atlas is created from the '_atlas' image in the ROM pack, which is loaded before the GLView is created (during loading of the ROM pack)
			_atlas: glCreateTexture(gl, BaseView.imgassets['_atlas']?.imgbin, undefined, gl.TEXTURE0),
			// Create the texture with dummy width and height, which will be updated later
			_atlas_dynamic: glCreateTexture(gl, null, { width: 1, height: 1 }, gl.TEXTURE1),
			post_processing_source_texture: null, // This will be created later in createFramebufferAndTexture
		};
	}

	@catchWebGLError
	public setSkyboxImages(ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
		GLView3D.setSkyboxImages(ids);
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
		gl.depthFunc(gl.GREATER);
		gl.enable(gl.BLEND);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.FRONT);
	}

	@catchWebGLError
	/**
	 * Creates the game shader programs (vertex and fragment shaders).
	 */
	private createGameShaderPrograms(): void {
		const gl = this.glctx;
		const program = gl.createProgram();
		if (!program) throw Error(`Failed to create the GLSL program! Aborting as we cannot create the GLView for the game!`);
		this.gameShaderProgram = program;
		const vertShader = glLoadShader(gl, gl.VERTEX_SHADER, GLView.vertexShaderCode);
		const fragShader = glLoadShader(gl, gl.FRAGMENT_SHADER, GLView.fragmentShaderTextureCode);

		gl.attachShader(program, vertShader);
		gl.attachShader(program, fragShader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw Error(`Unable to initialize the shader program: ${gl.getProgramInfoLog(program)} `);
		}
	}

	@catchWebGLError
	/**
	 * Sets up the vertex shader locations for the game shader program.
	 */
	private setupVertexShaderLocations(): void {
		const gl = this.glctx;
		const locations = {
			vertex: gl.getAttribLocation(this.gameShaderProgram, 'a_position'),
			texcoord: gl.getAttribLocation(this.gameShaderProgram, 'a_texcoord'),
			zcoord: gl.getAttribLocation(this.gameShaderProgram, 'a_pos_z'),
			color_override: gl.getAttribLocation(this.gameShaderProgram, 'a_color_override'),
			atlas_id: gl.getAttribLocation(this.gameShaderProgram, 'a_atlas_id'),
		};
		this.vertexLocation = locations.vertex;
		this.texcoordLocation = locations.texcoord;
		this.zcoordLocation = locations.zcoord;
		this.color_overrideLocation = locations.color_override;
		this.atlas_idLocation = locations.atlas_id;
		this.resolutionLocation = gl.getUniformLocation(this.gameShaderProgram, 'u_resolution')!;
		this.texture0Location = gl.getUniformLocation(this.gameShaderProgram, 'u_texture0')!;
		this.texture1Location = gl.getUniformLocation(this.gameShaderProgram, 'u_texture1')!;
		this.gameShaderScaleLocation = gl.getUniformLocation(this.gameShaderProgram, 'u_scale');
	}


	/**
	 * Gets the texture coordinates for the vertices of the rectangles.
	 * The texture coordinates are used both for the game shader (sprites) and the CRT shader (full-screen quad).
	 * @returns
	 */
	private static getTextureCoordinates(): Float32Array {
		const textureCoordinates = new Float32Array(VERTEXCOORDS_SIZE * MAX_SPRITES);
		for (let i = 0; i < VERTEXCOORDS_SIZE * MAX_SPRITES - VERTEXCOORDS_SIZE; i += VERTEXCOORDS_SIZE) {
			textureCoordinates.set([
				0.0, 0.0,
				1.0, 0.0,
				0.0, 1.0,
				0.0, 1.0,
				1.0, 0.0,
				1.0, 1.0,
			], i);
		}
		return textureCoordinates;
	}

	/**
	 * Compiles a WebGL shader from the provided source code.
	 * @param type The type of shader to compile (either gl.VERTEX_SHADER or gl.FRAGMENT_SHADER).
	 * @param source The source code of the shader.
	 * @returns The compiled WebGL shader.
	 * @throws An error if the shader fails to compile.
	 */

	@catchWebGLError
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
		this.textures['post_processing_source_texture'] = glCreateTexture(gl, undefined, { width, height }, gl.TEXTURE8); // Use TEXTURE8 for the post-processing shader texture

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
	@catchWebGLError
	override handleResize(this: GLView): void {
		if (this.isRendering) {
			// If a frame is currently being drawn, set the needsResize flag and return
			this.needsResize = true;
			return;
		}

		super.handleResize();
		const gl = this.glctx;
		if (gl) {
			// Set the resolution uniform
			if (this.CRTShaderResolutionLocation) { // This is only set if the additional shader is being used
				gl.useProgram(this.CRTShaderProgram);
				gl.uniform2fv(this.CRTShaderResolutionLocation, new Float32Array([this.canvas.width, this.canvas.height]));
				gl.useProgram(this.gameShaderProgram);
			}
		}

		GLView3D.camera.setAspect(this.offscreenCanvasSize.x / this.offscreenCanvasSize.y);

		// Clear the needsResize flag
		this.needsResize = false;
	}

	override drawgame(clearCanvas: boolean = true): void {
		this.isRendering = true;
		super.drawgame(clearCanvas);

		this.drawSkybox(); // Draw the skybox if it exists

		// Draw all the sprites to a texture using the main shader
		this.renderSpriteBatch();
		GLView3D.renderMeshBatch();
		// this.saveTextureToFile();
		// debugger;

		// Draw a full-screen quad using the post-processing shader
		this.applyCrtPostProcess();

		glSwitchProgram(this.glctx, this.gameShaderProgram); // Switch back to the main shader

		this.isRendering = false;

		// Check if a resize was requested while rendering
		if (this.needsResize) {
			this.handleResize();
		}
	}

	public saveFramebufferToFile(): void {
		const gl = this.glctx;
		// 2. Read the pixels from the framebuffer into an array
		const width = gl.drawingBufferWidth;
		const height = gl.drawingBufferHeight;
		const pixels = new Uint8Array(width * height * 4);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// 3. Create a new canvas and context
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');

		// 4. Put the pixel data into an ImageData object and draw it to the canvas
		const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
		context.putImageData(imageData, 0, 0);

		// Flip the context vertically
		context.scale(1, -1);
		context.translate(0, -height);

		// 5. Convert the canvas to a data URL and download it as an image
		const a = document.createElement('a');
		a.download = 'image.png';
		a.href = canvas.toDataURL();
		a.click();
	}

	public saveTextureToFile(): void {
		const gl = this.glctx;

		// 1. Bind the framebuffer that has the texture attached
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

		// 2. Read the pixels from the framebuffer into an array
		const width = this.canvas.width;  // replace with the width of your texture
		const height = this.canvas.height;  // replace with the height of your texture
		const pixels = new Uint8Array(width * height * 4);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

		// 3. Create a new canvas and context
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');

		// 4. Put the pixel data into an ImageData object
		const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);

		// Draw the image data to the canvas
		context.putImageData(imageData, 0, 0);

		// 5. Flip the canvas vertically
		const tempCanvas = document.createElement('canvas');
		tempCanvas.width = width;
		tempCanvas.height = height;
		const tempContext = tempCanvas.getContext('2d');
		tempContext.putImageData(context.getImageData(0, 0, width, height), 0, 0);
		context.clearRect(0, 0, width, height);
		context.save();
		context.scale(1, -1);
		context.drawImage(tempCanvas, 0, -height);
		context.restore();

		// 6. Convert the canvas to a data URL and download it as an image
		const a = document.createElement('a');
		a.download = 'image.png';
		a.href = canvas.toDataURL();
		a.click();

		// 7. Unbind the framebuffer to return to default rendering to the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	@catchWebGLError
	/**
	 * Draws a full-screen quad using the CRT shader.
	 */
	private applyCrtPostProcess(): void {
		const gl = this.glctx;
		// Bind the default framebuffer so that the rendering output goes to the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		// Set the viewport to match the size of the offscreen framebuffer
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);

		// Switch to the post-processing shader
		glSwitchProgram(gl, this.CRTShaderProgram);

		// Bind the vertex position buffer
		gl.bindBuffer(gl.ARRAY_BUFFER, this.CRTShaderVertexBuffer);
		gl.vertexAttribPointer(this.CRTShaderVertexLocation, POSITION_COMPONENTS, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(this.CRTShaderVertexLocation);

		// Bind the texcoord buffer
		gl.bindBuffer(gl.ARRAY_BUFFER, this.CRTShaderTexcoordBuffer);
		gl.vertexAttribPointer(this.CRTShaderTexcoordLocation, TEXCOORD_COMPONENTS, gl.FLOAT, false, 0, 0);
		gl.enableVertexAttribArray(this.CRTShaderTexcoordLocation);

		// Update the time uniform
		const currentTime = Date.now() / 1000; // Get the current time in seconds
		gl.uniform1f(this.CRTShaderTimeLocation, currentTime); // Add this line
		gl.uniform1f(this.CRTShaderRandomLocation, Math.random()); // Add this line

		// Draw the full-screen quad
		gl.drawArrays(gl.TRIANGLES, SPRITE_DRAW_OFFSET, VERTICES_PER_SPRITE);
	}

	/**
	 * Overrides the base class method to clear the WebGL canvas.
	 */
	@catchWebGLError
	override clear(): void {
		const gl = this.glctx;
		gl.clearDepth(0.0);

		// Clear the texture
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// Clear the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	}

	/**
	 * Draws all the sprites that have been queued for drawing using WebGL.
	 * This method should be called once per frame after all sprites have been queued.
	 */
	@catchWebGLError
        public renderSpriteBatch(): void {
                GLView2D.renderSpriteBatch(this);
        }

	/**
	 * Updates a WebGL buffer with new data.
	 * @param gl The WebGL rendering context.
	 * @param buffer The buffer to update.
	 * @param target The target buffer object.
	 * @param offset The offset into the buffer to start updating.
	 * @param data The new data to write into the buffer.
	 */

	/**
	 * Draws an image on the canvas using WebGL.
	 * @param options An object containing the image's position, size, and other options.
	 * @throws An error if the image metadata cannot be found.
	 */
        override drawImg(options: DrawImgOptions): void {
                GLView2D.drawImg(this, options);
        }

	/**
	 * Gets the texture coordinates for the image based on the flip flags.
	 * These texture coordinates are used to flip the image horizontally or vertically.
	 * The texture coordinates are stored in the image metadata and are pre-calculated for each image by the rompacker.
	 * @param flip_h Whether to flip the image horizontally.
	 * @param flip_v Whether to flip the image vertically.
	 * @param imgmeta The metadata for the image.
	 * @returns The texture coordinates for the image.
	 */
        private getTexCoords(flip_h: boolean, flip_v: boolean, imgmeta: ImgMeta): number[] {
                return GLView2D.getTexCoords(flip_h, flip_v, imgmeta);
        }

        private updateBuffers(gl: WebGL2RenderingContext, vertexcoords: Float32Array, texcoords: Float32Array, zcoords: Float32Array, color_override: Float32Array, atlasid: Uint8Array, index: number): void {
                GLView2D.updateBuffers(this, gl, vertexcoords, texcoords, zcoords, color_override, atlasid, index);
        }

	@catchWebGLError
	public drawMesh3D(
		positions: Float32Array,
		texcoords: Float32Array,
		normals: Float32Array | undefined,
		matrix: Float32Array,
		color: Color = DEFAULT_VERTEX_COLOR,
		atlasId: number = 0,
		material?: Material,
		shadow?: { map: ShadowMap; matrix: Float32Array; strength: number },
	): void {
		GLView3D.meshesToDraw.push({ positions, texcoords, normals, matrix, color, atlasId, material, shadow });
	}

	/**
	 * Corrects the start and end coordinates of an area to ensure that the start coordinates are less than the end coordinates.
	 * @param x The x-coordinate of the start of the area.
	 * @param y The y-coordinate of the start of the area.
	 * @param ex The x-coordinate of the end of the area.
	 * @param ey The y-coordinate of the end of the area.
	 * @returns An array containing the corrected start and end coordinates.
	 */
        private correctAreaStartEnd(x: number, y: number, ex: number, ey: number) {
                return GLView2D.correctAreaStartEnd(x, y, ex, ey);
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

	private _dynamicAtlasIndex: number | null = null;

	public get dynamicAtlas(): number | null {
		return this._dynamicAtlasIndex;
	}

	public set dynamicAtlas(index: number) {
		function generateAtlasName(atlasIndex: number): string {
			const idxStr = atlasIndex.toString().padStart(2, '0');
			return atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
		}

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
		const atlasImage = BaseView.imgassets[atlasName]?.imgbin;
		if (!atlasImage) {
			console.error(`Atlas image with name '${atlasName}' not found!`);
			return;
		}

		const gl = this.glctx;
		// Create the dynamic atlas texture
		this.textures['_atlas_dynamic'] = glCreateTexture(gl, atlasImage, { width: atlasImage.width, height: atlasImage.height }, gl.TEXTURE1);

		// Update the dynamic atlas texture with the new image
		gl.bindTexture(gl.TEXTURE_2D, this.textures['_atlas_dynamic']);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasImage.width, atlasImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlasImage);
	}
}
