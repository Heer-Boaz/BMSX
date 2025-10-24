import { BFont } from '../core/font';
import { $ } from '../core/game';
import { GameOptions } from '../core/gameoptions';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { multiply_vec, multiply_vec2, shallowCopy } from '../utils/utils';
import { Input } from '../input/input';
import type { id2imgres, vec2 } from '../rompack/rompack';
import { type RegisterablePersistent } from '../rompack/rompack';
import * as SpritesPipeline from './2d/sprites_pipeline';
import * as MeshPipeline from './3d/mesh_pipeline';
import * as ParticlesPipeline from './3d/particles_pipeline';
import * as SkyboxPipeline from './3d/skybox_pipeline';
import type { GPUBackend, RenderContext, TextureHandle } from './backend/pipeline_interfaces';
import { RenderPassLibrary } from './backend/renderpasslib';
import { RenderGraphRuntime, buildFrameData } from './graph/rendergraph';
import { LightingSystem } from './lighting/lightingsystem';
import { calculateCenteredBlockX, renderGlyphs, wrapGlyphs } from './glyphs';
import type {
	GameViewHost,
	GameViewCanvas,
	OverlayManager,
	DisplayModeController,
	WindowEventHub,
	ViewportMetrics,
	ViewportMetricsProvider,
	OnscreenGamepadHandleProvider,
} from '../platform';
import type {
	RectRenderSubmission,
	ImgRenderSubmission,
	PolyRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	GlyphRenderSubmission,
	SkyboxImageIds,
} from './shared/render_types';
export type {
	color,
	FlipOptions,
	RenderLayer,
	RectRenderSubmission,
	ImgRenderSubmission,
	PolyRenderSubmission,
	MeshRenderSubmission,
	ParticleRenderSubmission,
	GlyphRenderSubmission,
	SkyboxImageIds,
} from './shared/render_types';

// Global gate used to coordinate rendering. When blocked, frames are skipped.
export const renderGate: GateGroup = taskGate.group('render:main');
export type RenderSubmitQueue = Pick<Pick<GameView, 'renderer'>['renderer'], 'submit'>;

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

export interface GameViewOpts {
	host: GameViewHost;
	viewportSize: vec2; // If not provided, defaults to 256x212 (MSX2) TODO: CHECK WHETHER THIS IS TRUE!
	canvasSize?: vec2; // If not provided, defaults to 2x viewport size
	offscreenSize?: vec2; // Optional offscreen render resolution; defaults to 2x viewport
}

/**
 * The `GameView` class is an abstract class that serves as the base for all views in the application.
 * It provides common functionality and properties that are shared across all views.
 */
export class GameView implements RegisterablePersistent, RenderContext {
	get registrypersistent(): true {
		return true;
	}

	public get id(): 'view' { return 'view'; }
	public dispose(): void {
		this.unbind();
	}

	public bind(): void {
		// Bind the view to the registry
		Registry.instance.register(this);
	}

	public unbind(): void {
		// Unbind the view from the registry
		Registry.instance.deregister(this);
		this.disposeReactiveSubscriptions();
	}

	private disposeReactiveSubscriptions(): void {
		if (GameView.fullscreenKeyListenerUnsub) {
			GameView.fullscreenKeyListenerUnsub();
			GameView.fullscreenKeyListenerUnsub = null;
		}
		if (GameView.windowedKeyListenerUnsub) {
			GameView.windowedKeyListenerUnsub();
			GameView.windowedKeyListenerUnsub = null;
		}
		while (this.reactiveDisposables.length > 0) {
			const dispose = this.reactiveDisposables.pop();
			if (dispose) dispose();
		}
	}

	private registerReactive(dispose: () => void): void {
		this.reactiveDisposables.push(dispose);
	}

	private getViewportMetricsProvider(): ViewportMetricsProvider | null {
		return this.host.getCapability('viewport-metrics');
	}

	private getOverlayManager(): OverlayManager | null {
		return this.host.getCapability('overlay');
	}

	private getWindowEventHub(): WindowEventHub | null {
		return this.host.getCapability('window-events');
	}

	private getDisplayModeController(): DisplayModeController | null {
		return this.host.getCapability('display-mode');
	}

	private getOnscreenGamepadHandleProvider(): OnscreenGamepadHandleProvider | null {
		return this.host.getCapability('onscreen-gamepad');
	}

	private readViewportMetrics(): ViewportMetrics {
		const provider = this.getViewportMetricsProvider();
		if (provider) return provider.getViewportMetrics();
		const bounds = this.surface.measureDisplay();
		return {
			document: { width: bounds.width, height: bounds.height },
			windowInner: { width: bounds.width, height: bounds.height },
			screen: { width: bounds.width, height: bounds.height },
		};
	}

	public readonly host: GameViewHost;
	public readonly surface: GameViewCanvas;
	public static imgassets: id2imgres = {};
	private static fullscreenKeyListenerUnsub: (() => void) | null = null;
	private static windowedKeyListenerUnsub: (() => void) | null = null;
	public accessor default_font: BFont;
	private readonly reactiveDisposables: (() => void)[] = [];

	public windowSize: vec2;
	public availableWindowSize: vec2;
	public viewportSize: vec2; // The size of the viewport, which is the size of the game buffer (e.g. 256x212 for the MSX2)
	public dx: number;
	public dy: number;
	public viewportScale: number;
	public canvasSize: vec2; // The size of the canvas, which may be different from the viewport size (e.g. when the GameView renders the game buffer to a larger canvas so that it can have more granular control over applying effects)

	public canvas_dx: number;
	public canvas_dy: number;
	public canvasScale: number;

	private _nativeCtx: unknown | null = null; // The underlying native rendering context (e.g. WebGL2RenderingContext or GPUDevice)
	public get nativeCtx(): unknown | null {
		return this._nativeCtx;
	}
	private _backend: GPUBackend | null = null;
	public get backendType(): GPUBackend['type'] {
		if (!this._backend) {
			throw new Error('[GameView] Backend type requested before backend was configured.');
		}
		return this._backend.type;
	}
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
		submit: {
			typed: (o: RenderSubmission) => void;
			particle: (o: ParticleRenderSubmission) => void;
			sprite: (o: ImgRenderSubmission) => void;
			mesh: (o: MeshRenderSubmission) => void;
			rect: (o: RectRenderSubmission) => void;
			poly: (o: PolyRenderSubmission) => void;
			glyphs: (o: GlyphRenderSubmission) => void;
		};
	} = {
			submit: {
				typed: (o: RenderSubmission) => {
					if (!o) {
						throw new Error('[GameView] Render submission was not provided.');
					}
					switch (o.type) {
						case 'img':
							this.renderer.submit.sprite(o);
							return;
						case 'mesh':
							this.renderer.submit.mesh(o);
							return;
						case 'particle':
							this.renderer.submit.particle(o);
							return;
						case 'rect':
							this.renderer.submit.rect(o);
							return;
						case 'poly':
							this.renderer.submit.poly(o);
							return;
						case 'glyphs':
							this.renderer.submit.glyphs(o);
							return;
					}
				},
				particle: (o: ParticleRenderSubmission) => { ParticlesPipeline.submitParticle({ ...o }); },
				sprite: (o: ImgRenderSubmission) => { SpritesPipeline.drawImg(o); },
				mesh: (o: MeshRenderSubmission) => { MeshPipeline.submitMesh({ ...o }); },
				rect: (o: RectRenderSubmission) => { o.kind === 'fill' ? SpritesPipeline.fillRectangle(o) : SpritesPipeline.drawRectangle(o); },
				poly: (o: PolyRenderSubmission) => { SpritesPipeline.drawPolygon(o.points, o.z, o.color, o.thickness ?? 1, o.layer); },
				glyphs: (o: GlyphRenderSubmission) => {
					let lines: string | string[] = o.glyphs;
					const resolvedFont = o.font ?? this.default_font;
					if (!resolvedFont) {
						throw new Error('[GameView] No font available for glyph rendering.');
					}
					o.font = resolvedFont;

					// Optional char-based wrapping
					if (typeof lines === 'string' && o.wrapChars !== undefined && o.wrapChars > 0) {
						lines = wrapGlyphs(lines, o.wrapChars);
					}
					let xx = o.x;
					// Optional simple centering within a block of width (pixels)
					if (o.centerBlockWidth && o.centerBlockWidth > 0) {
						const arr = Array.isArray(lines) ? lines : [lines];
						xx += calculateCenteredBlockX(arr, o.font.char_width('a'), o.centerBlockWidth);
					}
					renderGlyphs(xx, o.y, lines, o.z ?? 950, o.font, o.color, o.backgroundColor, o.layer);
				},
			},
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

	constructor(opts: GameViewOpts) {
		if (!opts || !opts.host) {
			throw new Error('[GameView] Missing GameViewHost dependency.');
		}
		if (!opts.host.surface) {
			throw new Error('[GameView] GameViewHost did not provide a render surface.');
		}
		Registry.instance.register(this);
		this.host = opts.host;
		this.surface = this.host.surface;
		this.viewportSize = shallowCopy(opts.viewportSize) as vec2;
		this.canvasSize = (shallowCopy(opts.canvasSize) ?? multiply_vec2(this.viewportSize, 2)) as vec2; // By default, the canvas is twice the size of the viewport!!
		// Offscreen resolution for internal render graph targets (view-agnostic, but usually twice the viewport size to allow for effects like CRT post processing)
		this.offscreenCanvasSize = shallowCopy(opts.offscreenSize ?? multiply_vec(this.viewportSize, 2)) as vec2;
		renderGate.begin({ blocking: true, category: 'init', tag: 'init' }); // Note that we don't store the token; We can end the scope by calling renderGate.end() without a token, assuming that the category is unique fot init. It means that we can safely end the scope later without worrying about late resolves or lifecycle issues.
	}

	public configureRenderTargets(dimensions: { viewportSize?: vec2; canvasSize?: vec2; offscreenSize?: vec2; }): void {
		if (!dimensions) {
			throw new Error('[GameView] configureRenderTargets called without dimensions.');
		}
		let viewportChanged = false;
		let canvasChanged = false;
		let offscreenChanged = false;

		if (dimensions.viewportSize !== undefined) {
			const viewport = dimensions.viewportSize;
			if (!viewport) {
				throw new Error('[GameView] viewportSize override must be provided when specified.');
			}
			if (viewport.x <= 0 || viewport.y <= 0) {
				throw new Error('[GameView] viewportSize override must be positive.');
			}
			if (this.viewportSize.x !== viewport.x || this.viewportSize.y !== viewport.y) {
				this.viewportSize = shallowCopy(viewport) as vec2;
				viewportChanged = true;
			}
		}

		if (dimensions.canvasSize !== undefined) {
			const canvas = dimensions.canvasSize;
			if (!canvas) {
				throw new Error('[GameView] canvasSize override must be provided when specified.');
			}
			if (canvas.x <= 0 || canvas.y <= 0) {
				throw new Error('[GameView] canvasSize override must be positive.');
			}
			if (this.canvasSize.x !== canvas.x || this.canvasSize.y !== canvas.y) {
				this.canvasSize = shallowCopy(canvas) as vec2;
				canvasChanged = true;
			}
		}

		if (dimensions.offscreenSize !== undefined) {
			const offscreen = dimensions.offscreenSize;
			if (!offscreen) {
				throw new Error('[GameView] offscreenSize override must be provided when specified.');
			}
			if (offscreen.x <= 0 || offscreen.y <= 0) {
				throw new Error('[GameView] offscreenSize override must be positive.');
			}
			if (this.offscreenCanvasSize.x !== offscreen.x || this.offscreenCanvasSize.y !== offscreen.y) {
				this.offscreenCanvasSize = shallowCopy(offscreen) as vec2;
				offscreenChanged = true;
			}
		}

		if (!(viewportChanged || canvasChanged || offscreenChanged)) {
			return;
		}

		if (canvasChanged) {
			this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		}

		if (!this.pipelineRegistry) {
			throw new Error('[GameView] Pipeline registry not configured while updating render targets.');
		}

		this.rebuildGraph();
		this.calculateSize();
		this.handleResize();
	}

	public init(): void {
		this.calculateSize();
		this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		this.handleResize();
		this.listenToMediaEvents();
		// Backend resources are configured externally via setBackend()
		this.handleResize();
		this.rebuildGraph();
		renderGate.endCategory('init'); // End the init scope without a token, assuming the category is unique for init.
	}

	/**
	 * Draws the game on the canvas. If `clearCanvas` is set to `true`, the canvas will be cleared before drawing.
	 * The method sorts the objects in the current space by depth and then iterates over them, calling their `paint` method
	 * if they are visible and not flagged for disposal.
	 *
	 * Rendering should be guarded by a global {@link renderGate}. When the gate is blocked (e.g. while the game state is being
	 * revived), this method immediately returns so no WebGL state is touched prematurely.
	 */
	public drawgame(): void {
		if (!renderGate.ready) return;
		const token = renderGate.begin({ blocking: true, category: 'frame', tag: 'frame' });
		const backend = this.backend;
		const renderGraph = this.renderGraph;
		if (!renderGraph) {
			renderGate.end(token);
			throw new Error('[GameView] Render graph not built before drawgame.');
		}
		try {
			backend.beginFrame();
			const frame = buildFrameData(this);
			renderGraph.execute(frame);
		} finally {
			$.emitPresentation('frameend', this, token);
			backend.endFrame();
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
		const metrics = this.readViewportMetrics();
		const documentWidth = metrics.document.width;
		const documentHeight = metrics.document.height;
		const innerWidth = metrics.windowInner.width;
		const innerHeight = metrics.windowInner.height;
		const screenWidth = metrics.screen.width;
		const screenHeight = metrics.screen.height;

		const fallbackWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const fallbackHeight = innerHeight > 0 ? innerHeight : screenHeight;
		let effectiveWidth = documentWidth;
		let effectiveHeight = documentHeight;
		if (fallbackWidth > effectiveWidth) {
			effectiveWidth = fallbackWidth;
		}
		if (fallbackHeight > effectiveHeight) {
			effectiveHeight = fallbackHeight;
		}

		const viewportWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const viewportHeight = innerHeight > 0 ? innerHeight : screenHeight;
		const viewportIsLandscape = viewportWidth > viewportHeight && viewportWidth !== 0 && viewportHeight !== 0;

		const layout = Input.instance.getOnscreenGamepadLayout(viewportWidth, viewportHeight);
		const onscreenControlsVisible = Boolean(Input.instance.isOnscreenGamepadEnabled && layout.visible);

		let adjustedWidth = effectiveWidth;
		if (onscreenControlsVisible
			&& GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas'
			&& viewportIsLandscape) {
			adjustedWidth = Math.max(0, adjustedWidth - (layout.left + layout.right));
		}

		let adjustedHeight = effectiveHeight;
		if (onscreenControlsVisible
			&& GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas'
			&& !viewportIsLandscape) {
			adjustedHeight = Math.max(0, adjustedHeight - layout.bottom);
		}

		self.windowSize = { x: adjustedWidth, y: adjustedHeight };
		self.availableWindowSize = { x: ~~adjustedWidth, y: ~~adjustedHeight };
		self.dx = self.availableWindowSize.x / self.viewportSize.x;
		self.dy = self.availableWindowSize.y / self.viewportSize.y;
		self.viewportScale = Math.min(self.dx, self.dy);

		self.canvas_dx = self.availableWindowSize.x / self.canvasSize.x;
		self.canvas_dy = self.availableWindowSize.y / self.canvasSize.y;
		self.canvasScale = Math.min(self.canvas_dx, self.canvas_dy);
	}

	public handleResize(): void {
		if (!this.surface.isVisible()) return;

		const metrics = this.readViewportMetrics();
		const innerWidth = metrics.windowInner.width;
		const innerHeight = metrics.windowInner.height;
		const screenWidth = metrics.screen.width;
		const screenHeight = metrics.screen.height;
		const viewportWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const viewportHeight = innerHeight > 0 ? innerHeight : screenHeight;
		const isLandscape = viewportWidth > viewportHeight && viewportWidth !== 0 && viewportHeight !== 0;

		const self = $.view || this;
		self.calculateSize();
		const displayWidth = ~~(self.canvasSize.x * self.canvasScale);
		const displayHeight = ~~(self.canvasSize.y * self.canvasScale);
		const layoutWidth = self.windowSize.x;
		const layoutHeight = self.windowSize.y;
		const layout = Input.instance.getOnscreenGamepadLayout(viewportWidth, viewportHeight);
		const onscreenControlsActive = Input.instance.isOnscreenGamepadEnabled
			&& layout.visible
			&& GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas';
		const horizontalOffset = (onscreenControlsActive && isLandscape) ? layout.left : 0;
		const displayLeft = Math.max(0, ~~((layoutWidth - displayWidth) / 2) + horizontalOffset);
		const displayTop = (isLandscape || !onscreenControlsActive)
			? Math.max(0, ~~((layoutHeight - displayHeight) / 2))
			: 0;

		this.surface.setDisplaySize(displayWidth, displayHeight);
		this.surface.setDisplayPosition(displayLeft, displayTop);

		if (Input.instance.isOnscreenGamepadEnabled) {
		const handlesProvider = this.getOnscreenGamepadHandleProvider();
		const handles = handlesProvider?.getHandles();
		if (handles) {
			const { dpad, actionButtons } = handles;
			const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
			const canvasRect = this.surface.measureDisplay();

			const updateBottomPosition = (control: typeof dpad, isRightSide: boolean): void => {
				const elementSize = control.measure();
				let newBottom: number;
				if (isLandscape) {
					newBottom = (viewportHeight - elementSize.height) / 2;
				} else if (isRightSide) {
					newBottom = 0;
				} else {
					const rightSideHeight = actionButtons.measure().height;
					newBottom = (rightSideHeight - elementSize.height) / 2;
				}
				control.setBottom(newBottom < 0 ? 0 : newBottom);
			};

			const updateScale = (control: typeof dpad, isRightSide: boolean): void => {
				let newScale = referenceDimension * 0.20 / 100;
				if (isLandscape && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'gamepad') {
					let maxSvgWidth: number;
					if (isRightSide) {
						maxSvgWidth = viewportWidth - (canvasRect.left + canvasRect.width);
					} else {
						maxSvgWidth = canvasRect.left;
					}
					if (maxSvgWidth < 0) {
						maxSvgWidth = 0;
					}
					const widthAttr = control.getNumericAttribute('width');
					if (widthAttr !== null && widthAttr > 0 && widthAttr * newScale > maxSvgWidth) {
						newScale = maxSvgWidth / widthAttr;
					}
				}
				control.setScale(newScale);
			};

			updateScale(dpad, false);
			updateScale(actionButtons, true);
			updateBottomPosition(dpad, false);
			updateBottomPosition(actionButtons, true);
		}
		}
	}

	public reset(): void {
	}

	/**
	 * Registers event listeners for window resize, orientation change, and fullscreen mode change.
	 * When any of these events occur, the `handleResize` method is called to recalculate the size of the canvas and adjust its position and scale.
	 */
	protected listenToMediaEvents(): void {
		const view = $.view ?? this;
		const events = this.getWindowEventHub();
		if (events) {
			const resizeDispose = events.subscribe('resize', () => view.handleResize.call(view));
			const orientationDispose = events.subscribe('orientationchange', () => view.handleResize.call(view));
			this.registerReactive(resizeDispose);
			this.registerReactive(orientationDispose);
		}

		const displayMode = this.getDisplayModeController();
		if (displayMode) {
			const dispose = displayMode.onChange(() => view.handleResize.call(view));
			this.registerReactive(dispose);
		}
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
		const events = this.getWindowEventHub();
		if (!events) {
			console.warn('[GameView] Window event hub not available; cannot request fullscreen transition.');
			return;
		}
		if (GameView.fullscreenKeyListenerUnsub) {
			GameView.fullscreenKeyListenerUnsub();
		}
		GameView.fullscreenKeyListenerUnsub = events.subscribe('keyup', GameView.triggerFullScreenOnFakeUserEvent);
	}

	public get fullscreen(): boolean {
		const controller = this.getDisplayModeController();
		return controller ? controller.isFullscreen() : false;
	}

	public static get fullscreenEnabled() {
		const view = $.view;
		if (!view) {
			throw new Error('[GameView] View not available while checking fullscreen support.');
		}
		const controller = view.getDisplayModeController();
		return controller ? controller.isSupported() : false;
	}

	public static async triggerFullScreenOnFakeUserEvent(): Promise<void> {
		const view = $.view;
		if (!view) {
			throw new Error('[GameView] View not available while entering fullscreen.');
		}
		if (GameView.fullscreenEnabled) {
			try {
				$.paused = true;
				const controller = view.getDisplayModeController();
				if (!controller) {
					console.warn('[GameView] Display mode controller not available; cannot enter fullscreen.');
					return;
				}
				await controller.setFullscreen(true);
			}
			catch (error) {
				console.error(error);
			}
			finally {
				$.paused = false;
			}
		}
		if (GameView.fullscreenKeyListenerUnsub) {
			GameView.fullscreenKeyListenerUnsub();
			GameView.fullscreenKeyListenerUnsub = null;
		}
	}

	public ToWindowed(): void {
		const events = this.getWindowEventHub();
		if (!events) {
			console.warn('[GameView] Window event hub not available; cannot request windowed transition.');
			return;
		}
		if (GameView.windowedKeyListenerUnsub) {
			GameView.windowedKeyListenerUnsub();
		}
		GameView.windowedKeyListenerUnsub = events.subscribe('keyup', GameView.triggerWindowedOnFakeUserEvent);
	}

	public static async triggerWindowedOnFakeUserEvent(): Promise<void> {
		const view = $.view;
		if (!view) {
			throw new Error('[GameView] View not available while exiting fullscreen.');
		}
		if (GameView.fullscreenEnabled) {
			try {
				$.paused = true;
				const controller = view.getDisplayModeController();
				if (!controller) {
					console.warn('[GameView] Display mode controller not available; cannot exit fullscreen.');
					return;
				}
				await controller.setFullscreen(false);
			}
			catch (error) {
				// NOTE: Historical bug reports mentioned debugger interactions triggering failures here.
				console.error(error);
			}
			finally {
				$.paused = false;
			}
		}
		if (GameView.windowedKeyListenerUnsub) {
			GameView.windowedKeyListenerUnsub();
			GameView.windowedKeyListenerUnsub = null;
		}
	}


	public showFadingOverlay(text: string) {
		const overlays = this.getOverlayManager();
		if (!overlays) {
			console.warn('[GameView] Overlay manager not available; skipping overlay presentation.');
			return;
		}
		const overlay = overlays.ensureOverlay('pause-overlay');
		overlay.setText(text);
		overlay.removeClass('fade-out');
		overlay.addClass('visible');
	}

	public hideFadingOverlay() {
		const overlays = this.getOverlayManager();
		if (!overlays) return;
		const overlay = overlays.getOverlay('pause-overlay');
		if (!overlay) return;
		overlay.addClass('fade-out');
		overlay.removeClass('visible');
		overlay.forceReflow();
		overlay.onAnimationEnd(() => {
			overlay.remove();
		});
	}

	public showPauseOverlay() {
		$.view.showFadingOverlay('⏸️');
	}

	public showResumeOverlay() {
		$.view.hideFadingOverlay();
	}

	public set backend(backend: GPUBackend) {
		if (!backend) {
			throw new Error('[GameView] Attempted to assign an invalid backend.');
		}
		this._backend = backend;
		this._nativeCtx = backend.context;
	}

	public get backend(): GPUBackend {
		if (!this._backend) {
			throw new Error('[GameView] Backend accessed before being configured.');
		}
		return this._backend;
	}
	public async initializeDefaultTextures(): Promise<void> {
		const atlas = GameView.imgassets['_atlas'];
		if (!atlas) {
			throw new Error("[GameView] Default atlas '_atlas' missing while initializing textures.");
		}
		const atlasImage = await atlas._imgbin;
		this.textures['_atlas'] = this.backend.createTexture(atlasImage, {});
		this.textures['_atlas_dynamic'] = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
		// Default material textures for meshes
		this.textures['_default_albedo'] = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
		// Normal map default (0.5,0.5,1.0)
		this.textures['_default_normal'] = this.backend.createSolidTexture2D(1, 1, [0.5, 0.5, 1.0, 1.0]);
		// Metallic/Roughness default: neutral (mr.g=1 keeps roughnessFactor, mr.b=1 keeps metallicFactor)
		this.textures['_default_mr'] = this.backend.createSolidTexture2D(1, 1, [1.0, 1.0, 1.0, 1.0]);
	}

	// (single handleResize implementation above in the class)

	public rebuildGraph(): void {
		const token = renderGate.begin({ blocking: true, category: 'rebuild_graph', tag: 'frame' });
		if (!this.lightingSystem) this.lightingSystem = new LightingSystem();
		if (!this.pipelineRegistry) {
			renderGate.end(token);
			throw new Error('[GameView] PipelineRegistry not configured before rebuildGraph.');
		}
		// GameView implements RenderContext directly
		this.renderGraph = this.pipelineRegistry.buildRenderGraph(this, this.lightingSystem);
		renderGate.end(token);
	}
	public setSkybox(images: SkyboxImageIds): void { SkyboxPipeline.setSkyboxImages(images); }
	public get skyboxFaceIds(): SkyboxImageIds | undefined { return SkyboxPipeline.skyboxFaceIds; }
	public get dynamicAtlas(): number | null { return this._dynamicAtlasIndex; }
	public set dynamicAtlas(index: number | null) {
		if (this._dynamicAtlasIndex === index) return;
		this.textures['_atlas_dynamic'] = null;
		this._dynamicAtlasIndex = index;
		if (index == null) { this.activeTexUnit = 1; this.bind2DTex(null); return; }
		const atlasName = generateAtlasName(index);
		const atlas = GameView.imgassets[atlasName];
		if (!atlas) {
			throw new Error(`[GameView] Dynamic atlas '${atlasName}' not found.`);
		}
		this.textures['_atlas_dynamic'] = this.backend.createTexture(atlas._imgbin, {});
	}


	// Texture binding helpers
	get activeTexUnit(): number | null {
		return this._activeTexUnit;
	}

	set activeTexUnit(u: number | null) {
		if (this.backendType !== 'webgl2') return; // Texture units are not a thing in WebGPU
		const backend = this.backend;
		this._activeTexUnit = u;
		if (u != null) {
			const setActiveTexture = backend.setActiveTexture;
			if (!setActiveTexture) {
				throw new Error('[GameView] WebGL2 backend does not implement setActiveTexture.');
			}
			setActiveTexture.call(backend, u);
		}
	}

	bind2DTex(tex: TextureHandle | null): void {
		if (this.backendType !== 'webgl2') return; // Texture units are not a thing in WebGPU
		if (this._activeTexture2D === tex) return;
		const backend = this.backend;
		const bindTexture2D = backend.bindTexture2D;
		if (!bindTexture2D) {
			throw new Error('[GameView] WebGL2 backend does not implement bindTexture2D.');
		}
		bindTexture2D.call(backend, tex);
		this._activeTexture2D = tex;
	}

	bindCubemapTex(tex: TextureHandle | null): void {
		if (this.backendType !== 'webgl2') return; // Texture units are not a thing in WebGPU
		if (this._activeCubemap === tex) return;
		const backend = this.backend;
		const bindTextureCube = backend.bindTextureCube;
		if (!bindTextureCube) {
			throw new Error('[GameView] WebGL2 backend does not implement bindTextureCube.');
		}
		bindTextureCube.call(backend, tex);
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

export type RenderSubmission = ({ type: 'img'; } & ImgRenderSubmission) | ({ type: 'mesh'; } & MeshRenderSubmission) | ({ type: 'particle'; } & ParticleRenderSubmission) | ({ type: 'poly'; } & PolyRenderSubmission) | ({ type: 'rect'; } & RectRenderSubmission) | ({ type: 'glyphs'; } & GlyphRenderSubmission);
