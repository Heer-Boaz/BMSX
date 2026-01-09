import { BFont } from '../core/font';
import { $ } from '../core/engine_core';
import { Registry } from '../core/registry';
import { multiply_vec, multiply_vec2 } from '../utils/vector_operations';
import { shallowcopy } from '../utils/shallowcopy';
import { Input } from '../input/input';
import type { vec2 } from '../rompack/rompack';
import { type RegisterablePersistent } from '../rompack/rompack';
import * as SkyboxPipeline from './3d/skybox_pipeline';
import * as render_queues from './shared/render_queues';
import type { AtmosphereParams, BackendContext, GPUBackend, RenderContext, RenderSubmission, RenderSubmitQueue, TextureHandle } from './backend/pipeline_interfaces';
import { RenderPassLibrary } from './backend/renderpasslib';
import { type RenderPassToken } from './backend/pipeline_interfaces';
import { RenderGraphRuntime, buildFrameData, updateExternalFrameTiming } from './graph/rendergraph';
import { LightingSystem } from './lighting/lightingsystem';
import { GameOptions } from '../core/gameoptions';
import * as renderQueues from './shared/render_queues';
import type {
	GameViewHost,
	GameViewCanvas,
	OverlayManager,
	DisplayModeController,
	WindowEventHub,
	ViewportMetrics,
	ViewportMetricsProvider,
	OnscreenGamepadHandleProvider,
	SubscriptionHandle,
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
import { generateAtlasName, ENGINE_ATLAS_INDEX, ENGINE_ATLAS_TEXTURE_KEY } from 'bmsx/rompack/rompack';
import { renderGate } from 'bmsx/core/engine_core';

const PRESENTATION_PASS_IDS = ['skybox', 'meshbatch', 'particles', 'sprites', 'crt'];

interface GameViewOpts {
	host: GameViewHost;
	viewportSize: vec2; // If not provided, defaults to 256x212 (MSX2) TODO: CHECK WHETHER THIS IS TRUE!
	canvasSize?: vec2; // If not provided, defaults to 2x viewport size
	offscreenSize?: vec2; // Optional offscreen render resolution; defaults to 2x viewport
}

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
			GameView.fullscreenKeyListenerUnsub.unsubscribe();
			GameView.fullscreenKeyListenerUnsub = null;
		}
		if (GameView.windowedKeyListenerUnsub) {
			GameView.windowedKeyListenerUnsub.unsubscribe();
			GameView.windowedKeyListenerUnsub = null;
		}
		while (this.reactiveDisposables.length > 0) {
			const sub = this.reactiveDisposables.pop();
			if (sub) sub.unsubscribe();
		}
	}

	private registerReactive(sub: SubscriptionHandle): void {
		this.reactiveDisposables.push(sub);
	}

	private getViewportMetricsProvider(): ViewportMetricsProvider {
		return this.host.getCapability('viewport-metrics');
	}

	private getOverlayManager(): OverlayManager {
		return this.host.getCapability('overlay');
	}

	private getWindowEventHub(): WindowEventHub {
		return this.host.getCapability('window-events');
	}

	private getDisplayModeController(): DisplayModeController {
		return this.host.getCapability('display-mode');
	}

	private getOnscreenGamepadHandleProvider(): OnscreenGamepadHandleProvider {
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
			visible: { width: bounds.width, height: bounds.height, offsetTop: 0, offsetLeft: 0 },
		};
	}

	public readonly host: GameViewHost;
	public readonly surface: GameViewCanvas;
	private static fullscreenKeyListenerUnsub: SubscriptionHandle = null;
	private static windowedKeyListenerUnsub: SubscriptionHandle = null;
	public accessor default_font: BFont;
	private readonly reactiveDisposables: SubscriptionHandle[] = [];

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

	private _nativeCtx: BackendContext = null; // The underlying native rendering context (e.g. WebGL2RenderingContext or GPUDevice)
	public get nativeCtx(): BackendContext {
		return this._nativeCtx;
	}
	private _backend: GPUBackend = null;
	public get backendType(): GPUBackend['type'] {
		if (!this._backend) {
			throw new Error('[GameView] Backend type requested before backend was configured.');
		}
		return this._backend.type;
	}
	public renderGraph: RenderGraphRuntime = null;
	private lightingSystem: LightingSystem = null;
	public offscreenCanvasSize!: vec2;
	public textures: { [k: string]: TextureHandle } = {};
	private _primaryAtlasIndex: number = null;
	private _secondaryAtlasIndex: number = null;
	public pipelineRegistry?: RenderPassLibrary;
	private presentationPassTokens: RenderPassToken[] = [];
	private presentationEnabled = true;
	// Texture binding cache
	private _activeTexUnit: number = null;
	private _activeTexture2D: TextureHandle = null;
	private _activeCubemap: TextureHandle = null;
	// CRT/post flags (used by passes)
	public enable_noise = false;
	public enable_colorbleed = false;
	public enable_scanlines = false;
	public enable_blur = false;
	public enable_glow = false;
	public enable_fringing = false;
	public enable_aperture = false;
	public enable_rgb565dither = true;
	public noiseIntensity = 0.4;
	public colorBleed: [number, number, number] = [0.02, 0.0, 0.0];
	public blurIntensity = 0.6;
	public glowColor: [number, number, number] = [0.12, 0.10, 0.09];
	public crt_postprocessing_enabled = true; // Whether to apply postprocessing in the CRT-shader, such as scanlines, noise, glow, etc.

	// Sprite ambient defaults (used when per-sprite override not provided)
	public spriteAmbientEnabledDefault = false;
	public spriteAmbientFactorDefault = 1.0;
	public viewportTypeIde: 'viewport' | 'offscreen' = 'viewport';
	private renderFrameIndex = 0;
	private lastRenderTimeSeconds = 0;

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

	// Renderer submission facade
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
			particle: (o: ParticleRenderSubmission) => {
				renderQueues.submit_particle(o);
			},
			sprite: (o: ImgRenderSubmission) => {
				renderQueues.submitSprite(o);
			},
			mesh: (o: MeshRenderSubmission) => {
				renderQueues.submitMesh(o);
			},
			rect: (o: RectRenderSubmission) => {
				render_queues.submitRectangle(o);
			},
			poly: (o: PolyRenderSubmission) => {
				render_queues.submitDrawPolygon(o);
			},
			glyphs: (o: GlyphRenderSubmission) => {
				render_queues.submitGlyphs(o)
			},
		},
	} as RenderSubmitQueue;

	// --- Ambient controls API (best-practice toggles) -------------------------
	public setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
		render_queues.setSkyboxTintExposure(tint, exposure);
	}
	public setParticlesAmbient(mode: 0 | 1, factor = 1.0): void {
		render_queues.setAmbientDefaults(mode, factor);
	}
	public setSpritesAmbient(enabled: boolean, factor = 1.0): void {
		this.spriteAmbientEnabledDefault = !!enabled;
		this.spriteAmbientFactorDefault = Math.max(0, Math.min(1, factor));
	}

	private applyPresentationPassState(): void {
		if (this.presentationPassTokens.length === 0) {
			return;
		}
		for (const token of this.presentationPassTokens) {
			token.set(this.presentationEnabled);
		}
	}

	public initializePresentationPassTokens(): void {
		if (!this.pipelineRegistry) {
			return;
		}
		this.presentationPassTokens = PRESENTATION_PASS_IDS.map(id => this.pipelineRegistry!.createPassToken(id));
		this.applyPresentationPassState();
	}

	public setPresentationPassesEnabled(enabled: boolean): void {
		if (this.presentationEnabled === enabled) {
			return;
		}
		this.presentationEnabled = enabled;
		this.applyPresentationPassState();
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
		this.viewportSize = shallowcopy(opts.viewportSize) as vec2;
		this.canvasSize = (shallowcopy(opts.canvasSize) ?? multiply_vec2(this.viewportSize, 2)) as vec2; // By default, the canvas is twice the size of the viewport!!
		// Offscreen resolution for internal render graph targets (view-agnostic, but usually twice the viewport size to allow for effects like CRT post processing)
		this.offscreenCanvasSize = shallowcopy(opts.offscreenSize ?? multiply_vec(this.viewportSize, 2)) as vec2;
		this.lastRenderTimeSeconds = $.platform.clock.now() / 1000;
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
				this.viewportSize = shallowcopy(viewport) as vec2;
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
				this.canvasSize = shallowcopy(canvas) as vec2;
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
				this.offscreenCanvasSize = shallowcopy(offscreen) as vec2;
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
			const nowSeconds = $.platform.clock.now() / 1000;
			updateExternalFrameTiming(this.renderFrameIndex, nowSeconds, nowSeconds - this.lastRenderTimeSeconds);
			this.renderFrameIndex += 1;
			this.lastRenderTimeSeconds = nowSeconds;
			const frame = buildFrameData(this);
			renderGraph.execute(frame);
		} finally {
			$.emit('frameend', this, token);
			backend.endFrame();
			renderGate.end(token);
		}
	}

	/**
	 * Comprehensive viewport sizing routine.
	 *
	 * This method gathers every dimension the host environment exposes (document, inner, screen, or any
	 * custom source supplied by the active platform)
	 * and derives two related concepts:
	 *  - `windowSize`/`availableWindowSize`: how much real estate we believe we can inhabit,
	 *    factoring in host shells that report a zero `innerWidth`/`innerHeight` while
	 *    an onscreen keyboard is sliding in (observed on several mobile web views).
	 *  - `viewportScale` and `canvasScale`: the ratio between that real estate and the
	 *    logical render sizes (`viewportSize` for gameplay, `canvasSize` for the backing buffer).
	 *    Ensure scale is a half-integer multiple of the logical viewport
	 *    (`viewportSize * viewportScale`) to reduce subpixel jitter when scaling non-integer factors.
	 *    We centre the resulting surface within the **largest** container reported by either
	 *
	 * Historical context / pitfalls:
	 *  - When the onscreen gamepad is enabled it becomes a first-class surface sharing the same
	 *    presentation field as the main canvas. Ignoring its footprint leads to either the game
	 *    canvas shrinking unpredictably or the controls falling off-screen. Every calculation in
	 *    this method treats those controls as essential viewports, not optional chrome.
	 *  - Prior to the onscreen-gamepad refactors we assumed the canvas could always consume
	 *    the full width of the container. Once the onscreen controls started participating
	 *    in normal flow (instead of being absolutely positioned), the gamepad effectively started
	 *    negotiating for horizontal space with the canvas. The layout simulator in
	 *    `tests/simulate_gamepad_positions_for_codex.js` captures how that shift collapses
	 *    available width if we do not pre-allocate "Lebensraum" for the gamepad.
	 *  - Fixed clamping to 20% of the larger screen dimension keeps the control overlays legible on
	 *    phones yet avoids dwarfing the canvas on tablets/desktops.
	 *  - We deliberately avoid defensive null checks here: the platform layer guarantees that
	 *    viewport metrics exist and that `OnscreenGamepadHandleProvider` returns handles while
	 *    the onscreen gamepad is enabled.
	 *
	 * The landscape branch further subtracts the horizontal footprint of both control clusters when
	 * the canvas is configured to "own" the shared space (`canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas'`).
	 * That mirrors how the static-flow layout squeezes the canvas; without this subtraction, the canvas
	 * scale would be computed optimistically and the host flow would shove the controls off-screen.
	 *
	 * After all of the above, we convert to integers (via `~~`) to stabilise pixel snapping.
	 * The downstream `handleResize` call relies on these invariant values when centering or
	 * pinning the canvas.
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

		let adjustedWidth = effectiveWidth;
		if (Input.instance.isOnscreenGamepadEnabled
			&& GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas'
			&& viewportIsLandscape) {
			const handlesProvider = this.getOnscreenGamepadHandleProvider();
			const handles = handlesProvider?.getHandles();
			if (handles) {
				const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
				const maxControlScale = referenceDimension * 0.20 / 100;
				const dpadWidthAttr = handles.dpad.getNumericAttribute('width');
				const actionButtonsWidthAttr = handles.actionButtons.getNumericAttribute('width');
				if (dpadWidthAttr !== null && actionButtonsWidthAttr !== null) {
					const dpadWidth = dpadWidthAttr * maxControlScale;
					const actionButtonsWidth = actionButtonsWidthAttr * maxControlScale;
					const reduction = dpadWidth + actionButtonsWidth;
					adjustedWidth = Math.max(0, adjustedWidth - reduction);
				}
			}
		}

		self.windowSize = { x: adjustedWidth, y: effectiveHeight };
		self.availableWindowSize = { x: Math.round(adjustedWidth), y: Math.round(effectiveHeight) };
		self.dx = self.availableWindowSize.x / self.viewportSize.x;
		self.dy = self.availableWindowSize.y / self.viewportSize.y;
		// self.viewportScale = Math.min(self.dx, self.dy);
		self.viewportScale = Math.floor(Math.min(self.dx, self.dy) * 2) / 2; // Snap to half-pixels to stabilise scaling steps

		self.canvas_dx = self.availableWindowSize.x / self.canvasSize.x;
		self.canvas_dy = self.availableWindowSize.y / self.canvasSize.y;
		self.canvasScale = Math.min(self.canvas_dx, self.canvas_dy);
	}

	/**
	 * Canonical resize pipeline for the GameView canvas and onscreen gamepad.
	 *
	 * A high-level map of the steps involved:
	 *  1. Guard: skip if the canvas is hidden (avoids pointless layout work when the view
	 *     is minimised or running headless).
	 *  2. Collect `visible` viewport data so we can react to runtime chrome intrusion (address bars,
	 *     gesture navigation, virtual keyboards). The `viewportBottomInset` is the delta between the
	 *     theoretical viewport and what is actually visible once those overlays are in place.
	 *  3. Delegate to `calculateSize` which normalises our measurements, accounts for the gamepad
	 *     "Lebensraum" subtraction, and populates the scaling fields.
	 *  4. Derive the displayed canvas width/height by multiplying the logical canvas size by the
	 *     computed scale. We centre those values within the **largest** container reported by either
	 *     the host layout tree or the global viewport to avoid jolting the canvas when the outer box temporarily reports
	 *     shrinking values (Safari tends to do this mid-resize).
	 *  5. Apply the computed size/position to the host surface wrapper.
	 *  6. If the onscreen gamepad is active, compute per-control scale and bottom offsets so that:
	 *     - Each control cluster scales to roughly 20% of the dominant dimension unless constrained by the space
	 *       left around the canvas (`GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'gamepad'`).
	 *       The modern layout means the canvas occupies part of the flow, so we explicitly
	 *       cap the control width by the leftover horizontal gutter to keep the controls visible instead
	 *       of overflowing above/below the canvas.
	 *     - Vertical positioning uses the **visible** viewport height from the metrics provider so that
	 *       the controls remain docked even while the host chrome animates. The earlier absolute-layout
	 *       approach ignored this and we saw negative "visual bottoms" in the simulator, effectively
	 *       pushing the buttons off the bottom edge on mobile Safari.
	 *
	 * Implementation notes and known quirks:
	 *  - The viewport metrics provider guarantees `visible` values, so we avoid optional chaining.
	 *  - `setBottom` expects integer values; we round after adding the bottom inset to stay consistent
	 *    with host pixel snapping and to keep the simulator's readings deterministic.
	 *  - The centring logic intentionally uses `Math.max(viewportWidth, windowSize.x, displayWidth)`
	 *    so that sporadic zero reports from `innerWidth` (observed while waking locked devices) do not
	 *    yank the canvas toward the origin.
	 *  - Landscape mode keeps both controls vertically centred against the `visible` span, whereas
	 *    portrait mode leaves the d-pad "floating" above the action cluster so thumbs are not fighting
	 *    for identical vertical real estate. These heuristics came out of multiple iteration passes,
	 *    hence the `updateBottomPosition` branching.
	 */
	public handleResize(): void {
		if (!this.surface.isVisible()) return;

		const metrics = this.readViewportMetrics();
		const innerWidth = metrics.windowInner.width;
		const innerHeight = metrics.windowInner.height;
		const screenWidth = metrics.screen.width;
		const screenHeight = metrics.screen.height;
		const viewportWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const viewportHeight = innerHeight > 0 ? innerHeight : screenHeight;
		const visibleViewportHeight = metrics.visible.height;
		const visibleViewportBottom = metrics.visible.offsetTop + visibleViewportHeight;
		const viewportBottomInset = Math.max(0, viewportHeight - visibleViewportBottom);

		const self = $.view || this;
		self.calculateSize();
		// const displayWidth = ~~(self.canvasSize.x * self.canvasScale);
		// const displayHeight = ~~(self.canvasSize.y * self.canvasScale);

		// const targetWidth = ~~(self.viewportSize.x * self.viewportScale);
		// const targetHeight = ~~(self.viewportSize.y * self.viewportScale);
		const targetWidth = Math.round(self.viewportSize.x * self.viewportScale);
		const targetHeight = Math.round(self.viewportSize.y * self.viewportScale);
		if (self.canvasSize.x !== targetWidth
			|| self.canvasSize.y !== targetHeight
			|| self.offscreenCanvasSize.x !== targetWidth
			|| self.offscreenCanvasSize.y !== targetHeight) {
			self.configureRenderTargets({ canvasSize: { x: targetWidth, y: targetHeight }, offscreenSize: { x: targetWidth, y: targetHeight } });
			return;
		}

		const displayWidth = self.canvasSize.x;
		const displayHeight = self.canvasSize.y;

		const horizontalContainer = Math.max(viewportWidth, self.windowSize.x, displayWidth);
		const verticalContainer = Math.max(viewportHeight, self.windowSize.y, displayHeight);
		let displayLeft = ~~((horizontalContainer - displayWidth) / 2);
		if (displayLeft < 0) {
			displayLeft = 0;
		}
		const isLandscape = self.availableWindowSize.x >= self.availableWindowSize.y;
		const onscreenGamepadEnabled = Input.instance.isOnscreenGamepadEnabled;
		let displayTop = isLandscape || !onscreenGamepadEnabled
			? ~~((verticalContainer - displayHeight) / 2)
			: 0;
		if (displayTop < 0) {
			displayTop = 0;
		}

		this.surface.setDisplaySize(displayWidth, displayHeight);
		this.surface.setDisplayPosition(displayLeft, displayTop);

		if (onscreenGamepadEnabled) {
			const handles = this.getOnscreenGamepadHandleProvider()!.getHandles()!;
			const { dpad, actionButtons } = handles;
			const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
			const bottomInset = viewportBottomInset;
			const canvasRect = this.surface.measureDisplay();

			const updateScale = (control: typeof dpad, isRightSide: boolean): void => {
				let newScale = referenceDimension * 0.20 / 100;
				if (isLandscape && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'gamepad') {
					let maxControlWidth: number;
					if (isRightSide) {
						maxControlWidth = viewportWidth - (canvasRect.left + canvasRect.width);
					} else {
						maxControlWidth = canvasRect.left;
					}
					if (maxControlWidth < 0) {
						maxControlWidth = 0;
					}
					const widthAttr = control.getNumericAttribute('width');
					if (widthAttr !== null && widthAttr > 0 && widthAttr * newScale > maxControlWidth) {
						newScale = maxControlWidth / widthAttr;
					}
				}
				const heightAttr = control.getNumericAttribute('height');
				if (heightAttr !== null && heightAttr > 0 && visibleViewportHeight > 0) {
					const maxScaleByHeight = visibleViewportHeight / heightAttr;
					if (maxScaleByHeight > 0 && newScale > maxScaleByHeight) {
						newScale = maxScaleByHeight;
					}
				}
				control.setScale(newScale);
			};

			updateScale(dpad, false);
			updateScale(actionButtons, true);
			const dpadSize = dpad.measure();
			const actionSize = actionButtons.measure();
			const centeredSpan = visibleViewportHeight;
			const clampBottom = (value: number): number => value > 0 ? Math.round(value) : 0;
			const updateBottomPosition = (control: typeof dpad, size: { height: number; }, isRightSide: boolean): void => {
				let newBottom: number;
				if (isLandscape) {
					const verticalRoom = Math.max(centeredSpan - size.height, 0);
					newBottom = bottomInset + verticalRoom / 2;
				} else if (isRightSide) {
					newBottom = bottomInset;
				} else {
					const referenceHeight = Math.max(actionSize.height, size.height);
					const verticalRoom = Math.max(referenceHeight - size.height, 0);
					newBottom = bottomInset + verticalRoom / 2;
				}
				control.setBottom(clampBottom(newBottom));
			};
			updateBottomPosition(dpad, dpadSize, false);
			updateBottomPosition(actionButtons, actionSize, true);
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
			GameView.fullscreenKeyListenerUnsub.unsubscribe();
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
			GameView.fullscreenKeyListenerUnsub.unsubscribe();
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
			GameView.windowedKeyListenerUnsub.unsubscribe();
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
			GameView.windowedKeyListenerUnsub.unsubscribe();
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
		const fallback = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
		this.textures['_atlas_primary'] = fallback; // Start with fallback to avoid undefined states and race conditions
		this.textures['_atlas_secondary'] = fallback;
		this.textures['_atlas_fallback'] = fallback;
		this._primaryAtlasIndex = null;
		this._secondaryAtlasIndex = null;
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		const engineAtlas = $.assets.img[engineAtlasName];
		if (!engineAtlas) {
			throw new Error(`[GameView] Engine atlas '${engineAtlasName}' missing.`);
		}
		const engineAtlasTexture = await $.texmanager.loadTextureFromAsset(engineAtlas, {}, engineAtlasName);
		this.textures[ENGINE_ATLAS_TEXTURE_KEY] = engineAtlasTexture;
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
	public get skyboxFaceIds(): SkyboxImageIds { return SkyboxPipeline.skyboxFaceIds; }
	private async resolveAtlasTexture(atlasName: string): Promise<TextureHandle> {
		const atlas = $.assets.img[atlasName];
		if (!atlas) {
			throw new Error(`[GameView] atlas '${atlasName}' not found.`);
		}
		return $.texmanager.loadTextureFromAsset(atlas, {}, atlasName);
	}
	private setAtlasIndex(indexKey: '_primaryAtlasIndex' | '_secondaryAtlasIndex', index: number | null): void {
		if (this[indexKey] === index) return;
		const atlas_id = indexKey === '_primaryAtlasIndex' ? '_atlas_primary' : '_atlas_secondary';
		if (index == null) {
			this[indexKey] = null;
			const fallback = this.textures['_atlas_fallback'] as TextureHandle;
			this.textures[atlas_id] = fallback;
			return;
		}
		const atlasName = generateAtlasName(index);
		this[indexKey] = index;
		const fallback = this.textures['_atlas_fallback'] as TextureHandle;
		this.textures[atlas_id] = fallback;
		void this.resolveAtlasTexture(atlasName).then((handle) => {
			if (this[indexKey] !== index) return;
			this.textures[atlas_id] = handle;
		});
	}

	public get primaryAtlas(): number { return this._primaryAtlasIndex; }
	public set primaryAtlas(index: number) {
		this.setAtlasIndex('_primaryAtlasIndex', index)
	}

	public get secondaryAtlas(): number { return this._secondaryAtlasIndex; }
	public set secondaryAtlas(index: number) {
		this.setAtlasIndex('_secondaryAtlasIndex', index)
	}

	// Texture binding helpers
	get activeTexUnit(): number {
		return this._activeTexUnit;
	}

	set activeTexUnit(u: number) {
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

	bind2DTex(tex: TextureHandle): void {
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

	bindCubemapTex(tex: TextureHandle): void {
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
