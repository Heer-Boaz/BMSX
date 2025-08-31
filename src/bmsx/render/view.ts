import { BaseModel } from '../core/basemodel';
import { BFont } from '../core/font';
import { $ } from '../core/game';
import { GameOptions } from '../core/gameoptions';
import type { Mesh } from '../core/mesh';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { multiply_vec, multiply_vec2, shallowCopy } from '../core/utils';
import { Input } from '../input/input';
import type { Area, Polygon, Size, Vector, id2imgres, vec2, vec3arr } from '../rompack/rompack';
import { Identifier, type RegisterablePersistent } from '../rompack/rompack';
import * as SpritesPipeline from './2d/sprites_pipeline';
import { AmbientLight, DirectionalLight, PointLight } from './3d/light';
import * as MeshPipeline from './3d/mesh_pipeline';
import * as ParticlesPipeline from './3d/particles_pipeline';
import * as SkyboxPipeline from './3d/skybox_pipeline';
import type { GPUBackend, RenderContext, TextureHandle } from './backend/pipeline_interfaces';
import { RenderPassLibrary } from './backend/renderpasslib';
import type { WebGLBackend } from './backend/webgl_backend';
import { RenderGraphRuntime, buildFrameData } from './graph/rendergraph';
import { LightingSystem } from './lighting/lightingsystem';

// Global gate used to coordinate rendering. When blocked, frames are skipped.
export const renderGate: GateGroup = taskGate.group('render:main');

export interface FlipOptions {
	flip_h: boolean;
	flip_v: boolean;
}

export interface DrawRectOptions {
	area: Area;
	color: color;
}

export interface DrawImgOptions {
	imgid: string;
	pos: Vector;
	scale?: vec2;
	flip?: FlipOptions;
	colorize?: color;
	// Optional ambient lighting override for world sprites
	ambientAffected?: boolean;
	ambientFactor?: number; // 0..1
	// Optional sprite layer for sorting/grouping: 'world' (default) or 'ui'
	layer?: 'world' | 'ui';
}

export type color = {
	r: number;
	g: number;
	b: number;
	a: number;
};

export interface DrawMeshOptions {
	mesh: Mesh;
	matrix: Float32Array;
	jointMatrices?: Float32Array[];
	morphWeights?: number[];
}

export interface DrawParticleOptions {
	position: vec3arr;
	size: number;
	color: color;
	texture?: WebGLTexture;
	// Optional ambient override
	ambientMode?: 0 | 1; // 0=unlit, 1=ambient
	ambientFactor?: number; // 0..1
}

export interface SkyboxImageIds {
	posX: string;
	negX: string;
	posY: string;
	negY: string;
	posZ: string;
	negZ: string;
}

const atlasNameCache = new Map<number, string>(); // Cache for atlas names to avoid regenerating them for each request
export function generateAtlasName(atlasIndex: number): string {
	// Check if the atlas name is already cached
	if (atlasNameCache.has(atlasIndex)) {
		return atlasNameCache.get(atlasIndex)!;
	}
	// Generate a new atlas name and cache it
	const idxStr = atlasIndex.toString().padStart(2, '0');
	const atlasName = atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
	atlasNameCache.set(atlasIndex, atlasName);
	return atlasName;
}

/**
 * The `BaseView` class is an abstract class that serves as the base for all views in the application.
 * It provides common functionality and properties that are shared across all views.
 */
export class GameView implements RegisterablePersistent, RenderContext {
	get registrypersistent(): true {
		return true;
	}

	public get id(): Identifier { return 'view'; }
	public dispose(): void {
		// Deregister from registry
		Registry.instance.deregister(this);
	}

	public canvas: HTMLCanvasElement;
	public context: CanvasRenderingContext2D;
	public static imgassets: id2imgres = {};
	public accessor default_font: BFont;

	public windowSize: Size;
	public availableWindowSize: Size;
	public viewportSize: Size; // The size of the viewport, which is the size of the game buffer (e.g. 256x212 for the MSX2)
	public dx: number;
	public dy: number;
	public viewportScale: number;
	public canvasSize: Size; // The size of the canvas, which may be different from the viewport size (e.g. when the RenderView renders the game buffer to a larger canvas so that it can have more granular control over applying effects)

	public canvas_dx: number;
	public canvas_dy: number;
	public canvasScale: number;

	// WebGL / pipeline state
	public nativeCtx: unknown | null = null;
	private _backend: GPUBackend | null = null;
	public get backendType() { return this._backend?.type }
	public renderGraph: RenderGraphRuntime | null = null;
	private lightingSystem: LightingSystem | null = null;
	public offscreenCanvasSize!: vec2;
	public textures: { [k: string]: unknown | null } = {};
	private _dynamicAtlasIndex: number | null = null;
	public pipelineRegistry?: RenderPassLibrary;
	// Texture binding cache
	private _activeTexUnit: number | null = null;
	private _activeTexture2D: unknown | null = null;
	private _activeCubemap: unknown | null = null;
	// CRT/post flags (used by passes)
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

	// Sprite ambient defaults (used when per-sprite override not provided)
	public spriteAmbientEnabledDefault = false;
	public spriteAmbientFactorDefault = 1.0;

    public atmosphere: AtmosphereParams = {
        fogD50: 320.0,
        fogStart: 120.0,
        fogColorLow: [0.90, 0.95, 1.00],
        fogColorHigh: [1.05, 1.02, 0.95],
        fogYMin: 0.0,
        fogYMax: 200.0,
        progressFactor: 0,
        enableAutoAnimation: false,
    };

	// Renderer submission facade (no legacy queues)
	public renderer: {
		submit: { particle: (o: DrawParticleOptions) => void; sprite: (o: DrawImgOptions) => void; mesh: (o: DrawMeshOptions) => void };
		swap: () => void;
	} = {
			submit: {
				particle: (o: DrawParticleOptions) => { ParticlesPipeline.submitParticle({ ...o }); },
				sprite: (o: DrawImgOptions) => { this.drawImg(o); },
				mesh: (o: DrawMeshOptions) => { MeshPipeline.submitMesh({ ...o }); },
			},
			swap: () => { /* no-op: feature queues handle their own swapping */ },
		};

	// --- Ambient controls API (best-practice toggles) -------------------------
	public setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
		SkyboxPipeline.setSkyboxTintExposure(tint, exposure);
	}
	public setParticlesAmbient(mode: 0 | 1, factor = 1.0): void {
		ParticlesPipeline.setAmbientDefaults(mode, factor);
	}
	public setSpritesAmbient(enabled: boolean, factor = 1.0): void {
		this.spriteAmbientEnabledDefault = !!enabled;
		this.spriteAmbientFactorDefault = Math.max(0, Math.min(1, factor));
	}

	constructor(viewportSize: Size, canvasSize?: Size,) {
		Registry.instance.register(this);
		this.viewportSize = shallowCopy(viewportSize) as Size;
		this.canvasSize = (shallowCopy(canvasSize) ?? multiply_vec2(viewportSize, 2)) as Size; // By default, the canvas is twice the size of the viewport!!
		this.canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		// Offscreen resolution for internal render graph targets (view-agnostic)
		this.offscreenCanvasSize = multiply_vec(viewportSize, 2);
		renderGate.begin({ blocking: true, category: 'init', tag: 'init' }); // Note that we don't store the token; We can end the scope by calling renderGate.end() without a token, assuming that the category is unique fot init. It means that we can safely end the scope later without worrying about late resolves or lifecycle issues.
	}

	public init(): void {
		this.calculateSize();
		this.canvas.width = this.canvasSize.x;
		this.canvas.height = this.canvasSize.y;
		this.handleResize();
		this.listenToMediaEvents();
		// Backend resources are configured externally via setBackend()
		this.handleResize();
		this.rebuildGraph();
		registerAtmosphereHotkeys(); // TODO: REMOVE
		renderGate.endCategory('init'); // End the init scope without a token, assuming the category is unique for init.
	}

	public drawbase(clearCanvas: boolean = true): void {
		// Base drawing logic goes here
		const model: BaseModel = $.model;
		model.applyViewSettings();
		$.model.currentSpace.sort_by_depth(); // Required for each frame as objects can change depth during the flow of the game
		$.model.currentSpace.objects.forEach(o => !o.disposeFlag && o.visible && (o.updateComponentsWithTag?.('render'), o.paint?.()));
	}

	/**
	 * Draws the game on the canvas. If `clearCanvas` is set to `true`, the canvas will be cleared before drawing.
	 * The method sorts the objects in the current space by depth and then iterates over them, calling their `paint` method
	 * if they are visible and not flagged for disposal.
	 *
	 * Rendering should be guarded by a global {@link renderGate}. When the gate is blocked (e.g. while the game state is being
	 * revived), this method immediately returns so no WebGL state is touched prematurely.
	 */
	public drawgame(clearCanvas = true): void {
		if (!renderGate.ready) return;
		const token = renderGate.begin({ blocking: true, category: 'frame', tag: 'frame' });
		try {
			this._backend.beginFrame();
			$.emit('framebegin', this, token);
			this.renderer.swap();
			const frame = buildFrameData(this);
			this.drawbase(clearCanvas);
			// No need to check for invalid or missing render graph, as we assume it's valid for the frame given the render gate that blocks rendering if no graph present
			$.emit('frameupdate', this, token);
			this.renderGraph!.execute(frame);
		} finally {
			$.emit('frameend', this, token);
			this._backend.endFrame();
			renderGate.end(token);
		}
	}

	/**
	 * Calculates the size of the canvas and the scale factor based on the current viewport size and window size.
	 * The `dx` and `dy` properties represent the ratio of the window size to the viewport size in the x and y directions, respectively.
	 * The `scale` property represents the minimum of `dx` and `dy`.
	 */
	public calculateSize(): void {
		const self = $.view || this;

		let w = Math.max(document.documentElement.clientWidth, window.innerWidth || screen.width);
		let h = Math.max(document.documentElement.clientHeight, window.innerHeight || screen.height);

		self.windowSize = { x: w, y: h };

		// We need to respect the size of the onscreen gamepad, but only if the onscreen gamepad is visible and only in landscape mode
		if (Input.instance.isOnscreenGamepadEnabled && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas') {
			// Determine whether we are in landscape or portrait mode
			const isLandscape = window.innerWidth > window.innerHeight;

			if (isLandscape) {
				const maxSvgScale = Math.max(window.innerWidth, window.innerHeight) * 0.20 / 100;
				// Get the SVG element
				const dpad_svg = document.querySelector<HTMLElement>('#d-pad-svg');
				const actionbuttons_svg = document.querySelector<HTMLElement>('#action-buttons-svg');

				const dpadWidth = parseInt(dpad_svg.getAttribute('width')!) * maxSvgScale;
				const actionButtonsWidth = parseInt(actionbuttons_svg.getAttribute('width')!) * maxSvgScale;

				// Calculate the maximum width of the windowSize based on the SVG elements
				w -= dpadWidth + actionButtonsWidth;
			}
		}

		self.availableWindowSize = { x: ~~w, y: ~~h };
		self.dx = self.availableWindowSize.x / self.viewportSize.x;
		self.dy = self.availableWindowSize.y / self.viewportSize.y;
		self.viewportScale = Math.min(self.dx, self.dy);

		self.canvas_dx = self.availableWindowSize.x / self.canvasSize.x;
		self.canvas_dy = self.availableWindowSize.y / self.canvasSize.y;
		self.canvasScale = Math.min(self.canvas_dx, self.canvas_dy);
	}

	public handleResize(): void {
		if (document.getElementById('gamescreen')!.style.visibility === 'hidden') return;
		// Determine whether we are in landscape or portrait mode
		const isLandscape = window.innerWidth > window.innerHeight;

		let self = $.view || this;
		self.calculateSize();
		self.canvas.style.width = `${~~(self.canvasSize.x * self.canvasScale)}px`;
		self.canvas.style.height = `${~~(self.canvasSize.y * self.canvasScale)}px`;
		self.canvas.style.left = `${~~((self.windowSize.x - self.canvas.width * self.canvasScale) / 2)}px`;
		let canvasTop: number;
		if (isLandscape || !Input.instance.isOnscreenGamepadEnabled) {
			canvasTop = ~~((self.windowSize.y - self.canvas.height * self.canvasScale) / 2);
		}
		else {
			canvasTop = 0;
		}
		self.canvas.style.top = `${canvasTop}px`;

		if (Input.instance.isOnscreenGamepadEnabled) {
			// Get the SVG element
			const dpad_svg = document.querySelector<HTMLElement>('#d-pad-svg');
			const actionbuttons_svg = document.querySelector<HTMLElement>('#action-buttons-svg');
			function updateBottomPosition(element: HTMLElement, isRightSide: boolean) {
				let newBottom: number;
				if (isLandscape) {
					newBottom = (self.availableWindowSize.y - element.getBoundingClientRect().height) / 2;
				}
				else {
					if (isRightSide) {
						newBottom = 0;
					}
					else {
						// Place the left side element such that it's middle is aligned with the middle of the right side element (actionbuttons_svg)
						const rightside_height = actionbuttons_svg.getBoundingClientRect().height
						const leftside_height = element.getBoundingClientRect().height;
						newBottom = (rightside_height - leftside_height) / 2;
					}
				}

				// Apply the new bottom position
				element.style.bottom = `${newBottom}`;
			}

			// Function to update the scale
			// @ts-ignore
			function updateScale(element: HTMLElement, isRightSide: boolean) {
				// Calculate the new scale
				let newScale = Math.max(window.innerWidth, window.innerHeight) * 0.20 / 100;

				// If in landscape mode, limit the scale so that the SVG element does not overlap with the canvas
				if (isLandscape && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'gamepad') {
					const canvasRect = self.canvas.getBoundingClientRect();
					let maxSvgWidth: number;
					if (isRightSide) {
						maxSvgWidth = ~~(window.innerWidth - (canvasRect.left + canvasRect.width));
					} else {
						maxSvgWidth = canvasRect.left;
					}
					const svgWidth = parseInt(element.getAttribute('width')!);
					if (svgWidth * newScale > maxSvgWidth) {
						newScale = maxSvgWidth / svgWidth;
					}
				}

				// Apply the new scale
				element.style.transform = `scale(${newScale})`;
			}

			// Update the scaling of the SVG elements
			updateScale(dpad_svg!, false);
			updateScale(actionbuttons_svg!, true);

			// Update the bottom position of the SVG elements
			updateBottomPosition(dpad_svg!, false);
			updateBottomPosition(actionbuttons_svg!, true);
		}
	}

	public reset(): void {
		;
	}

	/**
	 * Registers event listeners for window resize, orientation change, and fullscreen mode change.
	 * When any of these events occur, the `handleResize` method is called to recalculate the size of the canvas and adjust its position and scale.
	 */
	protected listenToMediaEvents(): void {
		const view = $.view;

		function handleResizeHelper() {
			view.handleResize.call(view);
		}

		window.addEventListener('resize', handleResizeHelper, false);
		window.addEventListener('orientationchange', handleResizeHelper, false);
		// https://stackoverflow.com/a/70719693
		window.matchMedia('(display-mode: fullscreen)').addEventListener('change', ({ matches }) => {
			if (matches) {
				window['isFullScreen'] = true;
			} else {
				window['isFullScreen'] = false;
			}
		});
	}

	/**
	 * Determines the maximum scale factor that can be applied to the original buffer dimensions to fit the current client dimensions while maintaining aspect ratio.
	 * @param clientWidth The current width of the client.
	 * @param clientHeight The current height of the client.
	 * @param originalBufferWidth The original width of the buffer.
	 * @param originalBufferHeight The original height of the buffer.
	 * @returns The maximum scale factor that can be applied to the original buffer dimensions.
	 */
	public determineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
		if (clientWidth >= clientHeight) {
			return clientHeight / originalBufferHeight;
		}
		else {
			return clientWidth / originalBufferWidth;
		}
	}

	public toFullscreen(): void {
		// https://zinoui.com/blog/javascript-fullscreen-api
		window.addEventListener('keyup', GameView.triggerFullScreenOnFakeUserEvent);
	}

	public get isFullscreen() {
		return window['isFullScreen'] ?? false;
	}

	public static get fullscreenEnabled() {
		return document.fullscreenEnabled || document['webkitFullscreenEnabled'] || document['webkitFullScreenEnabled'] || document['mozFullScreenEnabled'];
	}

	public static triggerFullScreenOnFakeUserEvent(): void {
		if (GameView.fullscreenEnabled) {
			try {
				global.$.paused = true;
				document.documentElement.requestFullscreen?.()
					.then(() => {
						global.$.paused = false;
					})
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});

				document.documentElement['mozRequestFullScreen']?.()
					.then(() => global.$.paused = false)
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});
				document.documentElement['webkitRequestFullScreen']?.();
				document.documentElement['webkitRequestFullscreen']?.();
			}
			catch (error) {
				console.error(error);
			}
		}
		window.removeEventListener('keyup', GameView.triggerFullScreenOnFakeUserEvent);
	}

	public ToWindowed(): void {
		window.addEventListener('keyup', GameView.triggerWindowedOnFakeUserEvent);
	}

	public static triggerWindowedOnFakeUserEvent(): void {
		if (GameView.fullscreenEnabled) {
			try {
				global.$.paused = true;
				document.exitFullscreen?.()
					.then(() => global.$.paused = false)
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});
				document['webkitExitFullscreen']?.();
				document['mozExitFullScreen']?.();
			}
			catch (error) {
				// !BUG: Heb een bug gezien waarbij dit voorkomt.
				// Lijkt overeen te komen met het gebruik van de debugger-mogelijkheden van Boaz
				console.error(error);
			}
		}
		window.removeEventListener('keyup', GameView.triggerWindowedOnFakeUserEvent);
	}


	public showFadingOverlay(text: string) {
		let pauseOverlay = document.getElementById('pause-overlay');
		if (!pauseOverlay) {
			pauseOverlay = document.createElement('div');
			pauseOverlay.id = 'pause-overlay';
			document.body.appendChild(pauseOverlay);
		}
		pauseOverlay.textContent = text;

		// Remove the fade-out class to reset the animation
		pauseOverlay.classList.remove('fade-out');

		// Add the visible class to show the overlay by setting the opacity to 1
		pauseOverlay.classList.add('visible');
	}

	public hideFadingOverlay() {
		let pauseOverlay = document.getElementById('pause-overlay');
		if (pauseOverlay) {
			// Add the fade-out class to start the animation
			pauseOverlay.classList.add('fade-out');
			// Remove the visible class to hide the overlay by setting the opacity to 0
			pauseOverlay.classList.remove('visible');
			// Force a reflow to restart the animation
			void pauseOverlay.offsetWidth;

			pauseOverlay.onanimationend = () => {
				pauseOverlay?.remove();
			}
		}
	}

	public showPauseOverlay() {
		$.view.showFadingOverlay('⏸️');
	}

	public showResumeOverlay() {
		$.view.hideFadingOverlay();
	}

	public clear(): void { /* handled by render graph clear pass */ }

	// Backend
	public set backend(backend: GPUBackend) {
		this._backend = backend;
	}

	public get backend(): GPUBackend { return this._backend; }
    public initializeDefaultTextures(): void {
        try {
            const atlasImage = GameView.imgassets['_atlas']?._imgbin as ImageBitmap | undefined;
            if (atlasImage) this.textures['_atlas'] = this.backend.createTextureFromImage(atlasImage, {});
            this.textures['_atlas_dynamic'] = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
            // Default material textures for meshes
            this.textures['_default_albedo'] = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
            // Normal map default (0.5,0.5,1.0)
            this.textures['_default_normal'] = this.backend.createSolidTexture2D(1, 1, [0.5, 0.5, 1.0, 1.0]);
            // Metallic/Roughness default: neutral (mr.g=1 keeps roughnessFactor, mr.b=1 keeps metallicFactor)
            this.textures['_default_mr'] = this.backend.createSolidTexture2D(1, 1, [1.0, 1.0, 1.0, 1.0]);
        } catch { /* ignore */ }
    }

	// (single handleResize implementation above in the class)

	public rebuildGraph(): void {
		const token = renderGate.begin({ blocking: true, category: 'rebuild_graph', tag: 'frame' });
		if (!this.lightingSystem) this.lightingSystem = new LightingSystem();
		if (!this.pipelineRegistry) { console.warn('[GameView] PipelineRegistry not set on view yet; skipping render graph build'); return; }
		if ($.debug) console.info('[GameView] Building render graph');
		// GameView implements RenderContext directly
		this.renderGraph = this.pipelineRegistry.buildRenderGraph(this, this.lightingSystem);
		renderGate.end(token);
	}

	public drawImg(options: DrawImgOptions): void {
		SpritesPipeline.drawImg(options);
	}

	public drawRectangle(options: DrawRectOptions): void { SpritesPipeline.drawRectangle(options); }

	public fillRectangle(options: DrawRectOptions): void { SpritesPipeline.fillRectangle(options); }

	/**
	 * Draws the outline of a polygon by drawing lines between its vertices.
	 * @param points Array of {x, y, z?} points (polygon vertices, in order)
	 * @param color Color to use for the outline
	 * @param thickness Line thickness in pixels (default 1)
	 */
	public drawPolygon(points: Polygon, z: number, color: color, thickness: number): void { SpritesPipeline.drawPolygon(points, z, color, thickness); }

	public drawMesh(options: DrawMeshOptions): void { this.renderer.submit.mesh(options); }

	public drawParticle(options: DrawParticleOptions): void { ParticlesPipeline.submitParticle({ position: options.position, size: options.size, color: options.color, texture: options.texture }); }

	public getPointLight(id: Identifier): PointLight | undefined { return MeshPipeline.getPointLight(id); }
	public setPointLight(id: Identifier, light: PointLight): void { MeshPipeline.addPointLight(id, light); }
	public removePointLight(id: Identifier): void { MeshPipeline.removePointLight(id); }
	public addDirectionalLight(id: Identifier, light: DirectionalLight): void { MeshPipeline.addDirectionalLight(id, light); }
	public removeDirectionalLight(id: Identifier): void { MeshPipeline.removeDirectionalLight(id); }
	public clearLights(): void { MeshPipeline.clearLights(); }
	public setAmbientLight(_light: AmbientLight): void { /* pulled later by mesh pass */ }
	public setSkybox(images: SkyboxImageIds): void { SkyboxPipeline.setSkyboxImages(images); }
	public get skyboxFaceIds(): SkyboxImageIds | undefined { return SkyboxPipeline.skyboxFaceIds; }
	public get dynamicAtlas(): number | null { return this._dynamicAtlasIndex; }
	public set dynamicAtlas(index: number | null) {
		if (this._dynamicAtlasIndex === index) return;
		this.textures['_atlas_dynamic'] = null;
		this._dynamicAtlasIndex = index;
		if (index == null) { this.activeTexUnit = 1; this.bind2DTex(null); return; }
		const atlasName = generateAtlasName(index);
		const atlasImage = GameView.imgassets[atlasName]?._imgbin;
		if (!atlasImage) { console.error(`Atlas '${atlasName}' not found`); return; }
		this.textures['_atlas_dynamic'] = this.backend.createTextureFromImage(atlasImage as ImageBitmap, {});
	}

	// Texture binding helpers
	get activeTexUnit(): number | null {
		return this._activeTexUnit;
	}

	set activeTexUnit(u: number | null) {
		if (this._backend.type !== 'webgl2') return; // Texture units are not a thing in WebGPU

		this._activeTexUnit = u;
		if (u != null) (this.backend as WebGLBackend).setActiveTexture?.(u);
	}

	bind2DTex(tex: TextureHandle | null): void {
		if (this._backend.type !== 'webgl2') return; // Texture units are not a thing in WebGPU
		if (this._activeTexture2D === tex) return;
		(this.backend as WebGLBackend).bindTexture2D?.(tex);
		this._activeTexture2D = tex;
	}

	bindCubemapTex(tex: TextureHandle | null): void {
		if (this._backend.type !== 'webgl2') return; // Texture units are not a thing in WebGPU

		if (this._activeCubemap === tex) return;
		(this.backend as WebGLBackend).bindTextureCube?.(tex);
		this._activeCubemap = tex;
	}
}

export interface AtmosphereParams {
    fogD50: number;
    fogStart: number;
    fogColorLow: [number, number, number];
    fogColorHigh: [number, number, number];
    fogYMin: number;
    fogYMax: number;
    progressFactor: number;
    enableAutoAnimation: boolean;
}

export function registerAtmosphereHotkeys(): void {
    window.addEventListener('keydown', (e) => {
        if (!$.view?.atmosphere) {
            console.warn('No atmosphere found on view; cannot toggle atmosphere settings');
            return;
        }
        if (e.key === 'f') {
            $.view.atmosphere.fogD50 = ($.view.atmosphere.fogD50 > 1e6) ? 320.0 : 1e9;
            console.info(`Fog ${$.view.atmosphere.fogD50 > 1e6 ? 'disabled' : 'enabled'} (d50=${$.view.atmosphere.fogD50})`);
        }
        else if (e.key === 'g') {
            const isNeutral = $.view.atmosphere.fogColorLow[0] === 1.0 && $.view.atmosphere.fogColorHigh[0] === 1.0
                           && $.view.atmosphere.fogColorLow[1] === 1.0 && $.view.atmosphere.fogColorHigh[1] === 1.0
                           && $.view.atmosphere.fogColorLow[2] === 1.0 && $.view.atmosphere.fogColorHigh[2] === 1.0;
            if (isNeutral) {
                $.view.atmosphere.fogColorLow = [0.90, 0.95, 1.00];
                $.view.atmosphere.fogColorHigh = [1.05, 1.02, 0.95];
            } else {
                $.view.atmosphere.fogColorLow = [1.0, 1.0, 1.0];
                $.view.atmosphere.fogColorHigh = [1.0, 1.0, 1.0];
            }
            console.info('Fog color gradient toggled');
        }
    });
}
