import { BFont } from './shared/bitmap_font';
import { $ } from '../core/engine';
import { multiply_vec2 } from '../common/vector';
import { shallowcopy } from '../common/shallowcopy';
import type { vec2 } from '../rompack/format';
import * as queues from './shared/queues';
import type { AtmosphereParams, BackendContext, GPUBackend, PresentationMode, RenderContext, RenderSubmission, RenderSubmitQueue, TextureHandle } from './backend/interfaces';
import { RenderPassLibrary } from './backend/pass_library';
import { CRTDitherType as DitherType, type RenderPassToken } from './backend/interfaces';
import { RenderGraphRuntime, buildFrameData, updateExternalFrameTiming } from './graph/graph';
import { LightingSystem } from './lighting/system';
import * as renderQueues from './shared/queues';
import type {
	GameViewHost,
	GameViewCanvas,
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
} from './shared/submissions';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_TEXTURE_KEY,
} from 'bmsx/rompack/format';
import { renderGate } from 'bmsx/core/engine';

const PRESENTATION_PASS_IDS = ['skybox', 'meshbatch', 'particles', 'framebuffer_2d', 'device_quantize', 'crt', 'host_overlay'];

interface GameViewOpts {
	host: GameViewHost;
	viewportSize: vec2; // If not provided, defaults to 256x212 (MSX2) TODO: CHECK WHETHER THIS IS TRUE!
	canvasSize?: vec2; // If not provided, defaults to 2x viewport size
	offscreenSize?: vec2; // Optional offscreen render resolution; defaults to 2x viewport
}

export class GameView implements RenderContext {
	public dispose(): void {
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

	public readonly host: GameViewHost;
	public readonly surface: GameViewCanvas;
	private static fullscreenKeyListenerUnsub: SubscriptionHandle = null;
	private static windowedKeyListenerUnsub: SubscriptionHandle = null;
	public accessor default_font: BFont;
	private readonly reactiveDisposables: SubscriptionHandle[] = [];

	public viewportSize: vec2; // The size of the viewport, which is the size of the game buffer (e.g. 256x212 for the MSX2)
	public viewportScale = 1;
	public canvasSize: vec2; // The size of the canvas, which may be different from the viewport size (e.g. when the GameView renders the game buffer to a larger canvas so that it can have more granular control over applying effects)
	public canvasScale = 1;

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
	public primaryAtlasIdInSlot: number | null = null;
	public secondaryAtlasIdInSlot: number | null = null;
	public skyboxFaceIds: SkyboxImageIds | null = null;
	public skyboxFaceUvRects: Float32Array | null = null;
	public skyboxFaceAtlasBindings: Int32Array | null = null;
	public skyboxFaceSizes: Int32Array | null = null;
	public pipelineRegistry?: RenderPassLibrary;
	private presentationPassTokens: RenderPassToken[] = [];
	private presentationEnabled = true;
	// Active texture unit cache
	private _activeTexUnit: number = null;
	// CRT/post flags (used by passes)
	public enable_noise = true;
	public enable_colorbleed = true;
	public enable_scanlines = true;
	public enable_blur = true;
	public enable_glow = true;
	public enable_fringing = true;
	public enable_aperture = false; // Whether to apply an aperture mask in the CRT shader; This is a stylistic choice that can be toggled independently of the other CRT effects
	public dither_type: number = DitherType.None;
	public noiseIntensity = 0.3;
	public colorBleed: [number, number, number] = [0.02, 0.0, 0.0];
	public blurIntensity = 0.6;
	public glowColor: [number, number, number] = [0.12, 0.10, 0.09];
	public crt_postprocessing_enabled = true; // Whether to apply postprocessing in the CRT-shader, such as scanlines, noise, glow, etc.

	// Sprite ambient defaults (used when per-sprite override not provided)
	public spriteAmbientEnabledDefault = false;
	public spriteAmbientFactorDefault = 1.0;
	public viewportTypeIde: 'viewport' | 'offscreen' = 'viewport';
	public presentationMode: PresentationMode = 'completed';
	public commitPresentationFrame = false;
	public presentationHistorySourceIndex: 0 | 1 = 0;
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
				queues.submitRectangle(o);
			},
			poly: (o: PolyRenderSubmission) => {
				queues.submitDrawPolygon(o);
			},
			glyphs: (o: GlyphRenderSubmission) => {
				queues.submitGlyphs(o)
			},
		},
	} as RenderSubmitQueue;

	// --- Ambient controls API (best-practice toggles) -------------------------
	public setSkyboxTintExposure(tint: [number, number, number], exposure = 1.0): void {
		queues.setSkyboxTintExposure(tint, exposure);
	}
	public setParticlesAmbient(mode: 0 | 1, factor = 1.0): void {
		queues.setAmbientDefaults(mode, factor);
	}
	public setSpritesAmbient(enabled: boolean, factor = 1.0): void {
		this.spriteAmbientEnabledDefault = !!enabled;
		this.spriteAmbientFactorDefault = Math.max(0, Math.min(1, factor));
	}
	public setSpriteParallaxRig(vy: number, scale: number, impact: number, impact_t: number, bias_px: number, parallax_strength: number, scale_strength: number, flip_strength: number, flip_window: number): void {
		queues.setSpriteParallaxRig(vy, scale, impact, impact_t, bias_px, parallax_strength, scale_strength, flip_strength, flip_window);
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

	public get presentationHistoryDestinationIndex(): 0 | 1 {
		return this.presentationHistorySourceIndex === 0 ? 1 : 0;
	}

	public configurePresentation(mode: PresentationMode, commitFrame: boolean): void {
		this.presentationMode = mode;
		this.commitPresentationFrame = commitFrame;
	}

	private resetPresentationHistory(): void {
		this.presentationMode = 'completed';
		this.commitPresentationFrame = false;
		this.presentationHistorySourceIndex = 0;
	}

	private finalizePresentation(): void {
		if (!this.commitPresentationFrame) {
			return;
		}
		this.presentationHistorySourceIndex = this.presentationHistoryDestinationIndex;
	}

	constructor(opts: GameViewOpts) {
		if (!opts || !opts.host) {
			throw new Error('[GameView] Missing GameViewHost dependency.');
		}
		if (!opts.host.surface) {
			throw new Error('[GameView] GameViewHost did not provide a render surface.');
		}
		this.host = opts.host;
		this.surface = this.host.surface;
		this.viewportSize = shallowcopy(opts.viewportSize) as vec2;
		this.canvasSize = (shallowcopy(opts.canvasSize) ?? multiply_vec2(this.viewportSize, 1)) as vec2; // By default, the canvas is twice the size of the viewport!!
		// Offscreen resolution for internal render graph targets (view-agnostic, but usually twice the viewport size to allow for effects like CRT post processing)
		this.offscreenCanvasSize = shallowcopy(opts.offscreenSize ?? multiply_vec2(this.viewportSize, 1)) as vec2;
		this.lastRenderTimeSeconds = $.platform.clock.now() / 1000;
		renderGate.begin({ blocking: true, category: 'init', tag: 'init' }); // Note that we don't store the token; We can end the scope by calling renderGate.end() without a token, assuming that the category is unique fot init. It means that we can safely end the scope later without worrying about late resolves or lifecycle issues.
	}

	public configureRenderTargets(dimensions: { viewportSize?: vec2; canvasSize?: vec2; offscreenSize?: vec2; viewportScale?: number; canvasScale?: number }): void {
		if (!dimensions) {
			throw new Error('[GameView] configureRenderTargets called without dimensions.');
		}
		let viewportChanged = false;
		let canvasChanged = false;
		let offscreenChanged = false;
		let viewportScaleChanged = false;
		let canvasScaleChanged = false;

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

		if (dimensions.viewportScale !== undefined) {
			if (this.viewportScale !== dimensions.viewportScale) {
				this.viewportScale = dimensions.viewportScale;
				viewportScaleChanged = true;
			}
		}

		if (dimensions.canvasScale !== undefined) {
			if (this.canvasScale !== dimensions.canvasScale) {
				this.canvasScale = dimensions.canvasScale;
				canvasScaleChanged = true;
			}
		}

		if (viewportChanged || canvasChanged) {
			// If resolutions changed without an explicit scale, we must ask the host
			// how to scale the new viewport. This also triggers a host-side layout refresh.
			if (dimensions.viewportScale === undefined) {
				const result = this.host.getSize(this.viewportSize, this.canvasSize);
				this.viewportScale = result.viewportScale;
				this.canvasScale = result.canvasScale ?? 1;
				viewportScaleChanged = true;
				canvasScaleChanged = true;
			}
		}

		if (!(viewportChanged || canvasChanged || offscreenChanged || viewportScaleChanged || canvasScaleChanged)) {
			return;
		}

		this.resetPresentationHistory();
		if (canvasChanged) {
			this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		}

		if (!this.pipelineRegistry) {
			throw new Error('[GameView] Pipeline registry not configured while updating render targets.');
		}

		this.rebuildGraph();
	}

	public init(): void {
		this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		// Backend resources are configured externally via setBackend()
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
			this.finalizePresentation();
		} finally {
			backend.endFrame();
			renderGate.end(token);
		}
	}

	public reset(): void {
	}

	public toFullscreen(): void {
		const events = this.host.getCapability('window-events');
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
		const controller = this.host.getCapability('display-mode');
		return controller ? controller.isFullscreen() : false;
	}

	public static get fullscreenEnabled() {
		const view = $.view;
		if (!view) {
			throw new Error('[GameView] View not available while checking fullscreen support.');
		}
		const controller = view.host.getCapability('display-mode');
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
				const controller = view.host.getCapability('display-mode');
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
		const events = this.host.getCapability('window-events');
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
				const controller = view.host.getCapability('display-mode');
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
		const overlays = this.host.getCapability('overlay');
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
		const overlays = this.host.getCapability('overlay');
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
		this.textures[ATLAS_PRIMARY_SLOT_ID] = fallback; // Start with fallback to avoid undefined states and race conditions
		this.textures[ATLAS_SECONDARY_SLOT_ID] = fallback;
		this.textures['_atlas_fallback'] = fallback;
		this.primaryAtlasIdInSlot = null;
		this.secondaryAtlasIdInSlot = null;
		this.skyboxFaceIds = null;
		this.skyboxFaceUvRects = null;
		this.skyboxFaceAtlasBindings = null;
		this.skyboxFaceSizes = null;
		this.textures[ENGINE_ATLAS_TEXTURE_KEY] = fallback;
		// Default material textures for meshes
		this.textures['_default_albedo'] = this.backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]);
		// Normal map default (0.5,0.5,1.0)
		this.textures['_default_normal'] = this.backend.createSolidTexture2D(1, 1, [0.5, 0.5, 1.0, 1.0]);
		// Metallic/Roughness default: neutral (mr.g=1 keeps roughnessFactor, mr.b=1 keeps metallicFactor)
		this.textures['_default_mr'] = this.backend.createSolidTexture2D(1, 1, [1.0, 1.0, 1.0, 1.0]);
	}

	public loadEngineAtlasTexture(): void {
		const engineAtlasTexture = $.texmanager.getTextureByUri(ENGINE_ATLAS_TEXTURE_KEY);
		if (!engineAtlasTexture) {
			throw new Error(`[GameView] Engine atlas '${ENGINE_ATLAS_TEXTURE_KEY}' not uploaded.`);
		}
		this.textures[ENGINE_ATLAS_TEXTURE_KEY] = engineAtlasTexture;
	}

	// (single handleResize implementation above in the class)

	public rebuildGraph(): void {
		const token = renderGate.begin({ blocking: true, category: 'rebuild_graph', tag: 'frame' });
		if (!this.lightingSystem) this.lightingSystem = new LightingSystem();
		if (!this.pipelineRegistry) {
			renderGate.end(token);
			throw new Error('[GameView] PipelineRegistry not configured before rebuildGraph.');
		}
		this.resetPresentationHistory();
		// GameView implements RenderContext directly
		this.renderGraph = this.pipelineRegistry.buildRenderGraph(this, this.lightingSystem);
		renderGate.end(token);
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
		const backend = this.backend;
		const bindTexture2D = backend.bindTexture2D;
		if (!bindTexture2D) {
			throw new Error('[GameView] WebGL2 backend does not implement bindTexture2D.');
		}
		bindTexture2D.call(backend, tex);
	}

	bindCubemapTex(tex: TextureHandle): void {
		if (this.backendType !== 'webgl2') return; // Texture units are not a thing in WebGPU
		const backend = this.backend;
		const bindTextureCube = backend.bindTextureCube;
		if (!bindTextureCube) {
			throw new Error('[GameView] WebGL2 backend does not implement bindTextureCube.');
		}
		bindTextureCube.call(backend, tex);
	}
}
