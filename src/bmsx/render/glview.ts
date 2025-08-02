import { multiply_vec, to_vec2arr } from '../core/utils';
import type { Polygon, Size, vec2, vec3arr } from '../rompack/rompack';
import { Identifier } from '../rompack/rompack';
import { checkWebGLError } from './glview.helpers';

import { glCreateTexture, glSwitchProgram } from './glutils';
import { catchWebGLError, generateAtlasName } from './glview.helpers';

import * as GLView2D from './2d/glview.2d';
import { BaseView, Color, DrawImgOptions, DrawMeshOptions, DrawRectOptions, SkyboxImageIds } from './view';

import { AmbientLight, DirectionalLight, PointLight } from '..';
import * as GLView3D from './3d/glview.3d';
import * as GLViewCRT from './post/glview.crt';

type texturetype = '_atlas' | '_atlas_dynamic' | 'post_processing_source_texture';

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

	private _applyNoise: boolean = true;
	private _applyColorBleed: boolean = true;
	private _applyScanlines: boolean = true;
	private _applyBlur: boolean = true;
	private _applyGlow: boolean = true;
	private _applyFringing: boolean = true;
	private _noiseIntensity: number = 0.4;
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
		GLView3D.init(this.offscreenCanvasSize);
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
		const gl = this.glctx;
		GLView2D.createSpriteShaderPrograms(gl); // Create the game shader programs
		GLView3D.createGameShaderPrograms3D(gl); // Create 3D shader program
		GLView3D.createSkyboxProgram(gl);
		GLView2D.setupSpriteShaderLocations(gl); // Set up the vertex shader locations for the game shader program
		GLView3D.setupVertexShaderLocations3D(gl); // Set up the vertex shader locations for the 3D shader
		GLView3D.setupSkyboxLocations(gl);
		this.setupBuffers(); // Set up the buffers for the game shader
		GLView2D.setupSpriteLocations(gl); // Set up the game shader locations
		GLView3D.setupGameShader3DLocations(gl); // Set up locations for 3D shader
		this.setupTextures(); // Set up the textures used by the shaders (such as the atlas texture and the post-processing shader texture)
		GLViewCRT.createCRTShaderPrograms(gl); // Create the CRT shader programs
		GLViewCRT.setupCRTShaderLocations(gl); // Set up the CRT shader locations
		GLViewCRT.createCRTVertexBuffer(gl, this.canvas.width, this.canvas.height); // Create the CRT shader vertex buffer for the CRT fragment shader
		GLViewCRT.createCRTShaderTexcoordBuffer(gl); // Create the CRT shader texture coordinate buffer for the CRT fragment shader
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
		GLView2D.setupDefaultUniformValues(gl, 2.0, to_vec2arr(this.offscreenCanvasSize)); // Set the default uniform values for the game shader

		GLView3D.setDefaultUniformValues(gl, 2.0);
		const crtOptions: GLViewCRT.CRTShaderOptions = { applyNoise: this.applyNoise, applyColorBleed: this.applyColorBleed, applyScanlines: this.applyScanlines, applyBlur: this.applyBlur, applyGlow: this.applyGlow, applyFringing: this.applyFringing, blurIntensity: this.blurIntensity, noiseIntensity: this.noiseIntensity, colorBleed: this.colorBleed, glowColor: this.glowColor };

		GLViewCRT.setDefaultUniformValues(gl, crtOptions); // Set the default uniform values for the CRT shader
	}

	/**
	 * Sets up the buffers for the game shader.
	 * This method initializes the vertex, texture coordinate, z-coordinate, and color override buffers for the game shader.
	 * The buffers are created and bound to the respective attributes in the shader program.
	 */
	@catchWebGLError
	private setupBuffers(): void {
		const gl = this.glctx;

		GLView2D.setupBuffers(gl);
		GLView3D.setupBuffers3D(gl); // Set up buffers for 3D
		GLView3D.createSkyboxBuffer(gl);
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
			_atlas_dynamic: glCreateTexture(gl, null, { x: 1, y: 1 }, gl.TEXTURE1),
			post_processing_source_texture: null, // This will be created later in createFramebufferAndTexture
		};
	}

	@catchWebGLError
	public setSkyboxImages(ids: { posX: string; negX: string; posY: string; negY: string; posZ: string; negZ: string }): void {
		GLView3D.setSkyboxImages(this.glctx, ids);
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
		this.textures['post_processing_source_texture'] = glCreateTexture(gl, undefined, { x: width, y: height }, gl.TEXTURE8); // Use TEXTURE8 for the post-processing shader texture

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
			GLViewCRT.handleResize(gl, this.canvas.width, this.canvas.height);
			gl.useProgram(GLView2D.spriteShaderProgram); // Switch to the game shader program
		}

		GLView3D.camera.setAspect(this.offscreenCanvasSize.x / this.offscreenCanvasSize.y);

		// Clear the needsResize flag
		this.needsResize = false;
	}

	override drawgame(clearCanvas: boolean = true): void {
		this.isRendering = true;
		super.drawgame(clearCanvas);

		const gl = this.glctx;

		GLView3D.drawSkybox(gl);
		GLView3D.renderMeshBatch(gl, this.framebuffer, this.canvas.width, this.canvas.height); // Render the 3D mesh batch to the framebuffer
		GLView2D.renderSpriteBatch(gl, this.framebuffer, this.canvas.width, this.canvas.height); // Render the sprite batch to the framebuffer
		// saveTextureToFile();

		// Draw a full-screen quad using the post-processing shader
		GLViewCRT.applyCrtPostProcess(gl, this.canvas.width, this.canvas.height);

		glSwitchProgram(gl, GLView2D.spriteShaderProgram); // Switch back to the main shader

		this.isRendering = false;

		// Check if a resize was requested while rendering
		if (this.needsResize) {
			this.handleResize();
		}
	}

	/**
	 * Overrides the base class method to clear the WebGL canvas.
	 */
	@catchWebGLError
	override clear(): void {
		if (checkWebGLError('before clear')) {
			throw new Error('WebGL error before clearing the canvas');
		}
		const gl = this.glctx;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.clearDepth(1.0);
		checkWebGLError('clearDepth');

		// Clear the texture
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		checkWebGLError('clearFramebuffer');

		// Clear the screen
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		checkWebGLError('clearScreen');
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
		const atlasImage = BaseView.imgassets[atlasName]?.imgbin;
		if (!atlasImage) {
			console.error(`Atlas image with name '${atlasName}' not found!`);
			return;
		}

		const gl = this.glctx;
		// Create the dynamic atlas texture
		this.textures['_atlas_dynamic'] = glCreateTexture(gl, atlasImage, { x: atlasImage.width, y: atlasImage.height }, gl.TEXTURE1);

		// Update the dynamic atlas texture with the new image
		gl.bindTexture(gl.TEXTURE_2D, this.textures['_atlas_dynamic']);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlasImage.width, atlasImage.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlasImage);
	}
}
