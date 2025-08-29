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
import { AmbientLight, DirectionalLight, PointLight } from './3d/light';
import * as MeshPipeline from './3d/mesh_pipeline';
import * as ParticlesPipeline from './3d/particles_pipeline';
import * as SkyboxPipeline from './3d/skybox_pipeline';
import type { GPUBackend } from './backend/pipeline_interfaces';
import { PipelineRegistry } from './backend/pipeline_registry';
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
export class GameView implements RegisterablePersistent {
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
	public renderGraph: RenderGraphRuntime | null = null;
	private graphInvalid = true;
	private lightingSystem: LightingSystem | null = null;
	public offscreenCanvasSize!: vec2;
	private isRendering = false;
	private needsResize = false;
	public textures: { [k: string]: unknown | null } = {};
	private _dynamicAtlasIndex: number | null = null;
	private _pipelineRegistry?: PipelineRegistry;
	// Texture binding cache
	private _activeTexUnit: number | null = null;
	private _activeTexture2D: WebGLTexture | null = null;
	private _activeCubemap: WebGLTexture | null = null;
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

	// Submission queues (double buffered)
	private _queuesFront: { particles: DrawParticleOptions[]; sprites: DrawImgOptions[]; meshes: DrawMeshOptions[] } = { particles: [], sprites: [], meshes: [] };
	private _queuesBack: { particles: DrawParticleOptions[]; sprites: DrawImgOptions[]; meshes: DrawMeshOptions[] } = { particles: [], sprites: [], meshes: [] };
	public renderer: {
		queues: { particles: DrawParticleOptions[]; sprites: DrawImgOptions[]; meshes: DrawMeshOptions[] };
		submit: { particle: (o: DrawParticleOptions) => void; sprite: (o: DrawImgOptions) => void; mesh: (o: DrawMeshOptions) => void };
		swap: () => void;
	} = {
			queues: this._queuesFront,
			submit: {
				particle: (o: DrawParticleOptions) => { this._queuesBack.particles.push({ ...o }); },
				sprite: (o: DrawImgOptions) => {
					this._queuesBack.sprites.push({
						...o,
						pos: o.pos ? { ...o.pos } : undefined,
						scale: o.scale ? { ...o.scale } : undefined,
						colorize: o.colorize ? { ...o.colorize } : undefined,
						flip: o.flip ? { ...o.flip } : undefined,
					});
				},
				mesh: (o: DrawMeshOptions) => { this._queuesBack.meshes.push({ ...o }); },
			},
			swap: () => {
				const f = this._queuesFront; const b = this._queuesBack;
				this._queuesFront = b; this._queuesBack = f;
				this._queuesBack.particles.length = 0;
				this._queuesBack.sprites.length = 0;
				this._queuesBack.meshes.length = 0;
				this.renderer.queues = this._queuesFront;
			},
		};

	constructor(viewportSize: Size, canvasSize?: Size,) {
		Registry.instance.register(this);
		this.viewportSize = shallowCopy(viewportSize) as Size;
		this.canvasSize = (shallowCopy(canvasSize) ?? multiply_vec2(viewportSize, 2)) as Size; // By default, the canvas is twice the size of the viewport!!
		this.canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		// Offscreen resolution for internal render graph targets (view-agnostic)
		this.offscreenCanvasSize = multiply_vec(viewportSize, 2);
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
		const token = renderGate.begin({ blocking: true, tag: 'frame' });
		try {
			this.isRendering = true;
			this.renderer.swap();
			const frame = buildFrameData(this as any);
			this.drawbase(clearCanvas);
			if (!this.renderGraph || this.graphInvalid) this.rebuildGraph();
			this.renderGraph!.execute(frame);
		} finally {
			this.isRendering = false;
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
		throw new Error("Method not implemented.");
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

	// Pipeline hooks
	public setPipelineRegistry(reg: PipelineRegistry) { this._pipelineRegistry = reg; this.graphInvalid = true; }
	public enablePass(id: string, enabled: boolean): void { this._pipelineRegistry?.setPassEnabled(id, enabled); }
	public isPassEnabled(id: string): boolean { return this._pipelineRegistry?.isPassEnabled(id) ?? true; }

	// Backend
	public setBackend(backend: GPUBackend): void { this._backend = backend; }
	public getBackend(): GPUBackend { if (!this._backend) throw new Error('Backend not set on GameView'); return this._backend; }
	public initializeDefaultTextures(): void {
		try {
			const atlasImage = GameView.imgassets['_atlas']?._imgbin as ImageBitmap | undefined;
			if (atlasImage) this.textures['_atlas'] = this.getBackend().createTextureFromImage(atlasImage, {});
			this.textures['_atlas_dynamic'] = this.getBackend().createSolidTexture2D(1, 1, [1, 1, 1, 1]);
		} catch { /* ignore */ }
	}

	// (single handleResize implementation above in the class)

	public rebuildGraph(): void {
		if (!this.lightingSystem) this.lightingSystem = new LightingSystem(this.nativeCtx as any);
		if (!this._pipelineRegistry) { console.warn('PipelineRegistry not set on view yet; deferring render graph build'); this.graphInvalid = true; return; }
		this.renderGraph = this._pipelineRegistry.buildRenderGraph(this as any, this.lightingSystem);
		this.graphInvalid = false;
	}

	public drawImg(options: DrawImgOptions): void { require('./2d/sprites_pipeline'); (require('./2d/sprites_pipeline') as any).drawImg(this as any, options); }

	public drawRectangle(options: DrawRectOptions): void { (require('./2d/sprites_pipeline') as any).drawRectangle(this as any, options); }

	public fillRectangle(options: DrawRectOptions): void { (require('./2d/sprites_pipeline') as any).fillRectangle(this as any, options); }

	/**
	 * Draws the outline of a polygon by drawing lines between its vertices.
	 * @param points Array of {x, y, z?} points (polygon vertices, in order)
	 * @param color Color to use for the outline
	 * @param thickness Line thickness in pixels (default 1)
	 */
	public drawPolygon(points: Polygon, z: number, color: color, thickness: number): void { (require('./2d/sprites_pipeline') as any).drawPolygon(this as any, points, z, color, thickness); }

	public drawMesh(options: DrawMeshOptions): void { this.renderer.submit.mesh(options); }

	public drawParticle(options: DrawParticleOptions): void { ParticlesPipeline.submitParticle({ position: options.position, size: options.size, color: options.color, texture: options.texture }); }

	public getPointLight(id: Identifier): PointLight | undefined { return MeshPipeline.getPointLight(id); }
	public setPointLight(id: Identifier, light: PointLight): void { MeshPipeline.addPointLight(this.nativeCtx as any, id, light); }
	public removePointLight(id: Identifier): void { MeshPipeline.removePointLight(this.nativeCtx as any, id); }
	public addDirectionalLight(id: Identifier, light: DirectionalLight): void { MeshPipeline.addDirectionalLight(this.nativeCtx as any, id, light); }
	public removeDirectionalLight(id: Identifier): void { MeshPipeline.removeDirectionalLight(this.nativeCtx as any, id); }
	public clearLights(): void { MeshPipeline.clearLights(this.nativeCtx as any); }
	public setAmbientLight(_light: AmbientLight): void { /* pulled later by mesh pass */ }
	public setSkybox(images: SkyboxImageIds): void { SkyboxPipeline.setSkyboxImages(images); }
	public get skyboxFaceIds(): SkyboxImageIds | undefined { return SkyboxPipeline.skyboxFaceIds; }
	public get dynamicAtlas(): number | null { return this._dynamicAtlasIndex; }
	public set dynamicAtlas(index: number | null) {
		if (this._dynamicAtlasIndex === index) return;
		this.textures['_atlas_dynamic'] = null;
		this._dynamicAtlasIndex = index;
		if (index == null) { this.activeTexUnit = 1; this.bind2DTex(null as any); return; }
		const atlasName = generateAtlasName(index);
		const atlasImage = GameView.imgassets[atlasName]?._imgbin;
		if (!atlasImage) { console.error(`Atlas '${atlasName}' not found`); return; }
		this.textures['_atlas_dynamic'] = this.getBackend().createTextureFromImage(atlasImage as ImageBitmap, {});
	}

	// Texture binding helpers
	get activeTexUnit(): number | null { return this._activeTexUnit; }
	set activeTexUnit(u: number | null) { this._activeTexUnit = u; if (u != null) { try { this.getBackend().setActiveTexture?.(u); } catch { /* noop: backend not ready */ } } }
	bind2DTex(tex: any | null): void { if (this._activeTexture2D === tex) return; try { this.getBackend().bindTexture2D?.(tex as any); } catch { /* noop */ } this._activeTexture2D = tex as any; }
	bindCubemapTex(tex: any | null): void { if (this._activeCubemap === tex) return; try { this.getBackend().bindTextureCube?.(tex as any); } catch { /* noop */ } this._activeCubemap = tex as any; }
}
