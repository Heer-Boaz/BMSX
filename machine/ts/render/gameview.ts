import { BFont } from './shared/bitmap_font';
import { machineManager } from '../core/machine_manager';
import type { vec2 } from '../rompack/format';
import type { BackendContext, GPUBackend, PresentationMode, RenderContext, TextureHandle } from './backend/backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS, RGBA8_SRGB_TEXTURE_PARAMS } from './backend/texture_params';
import { RenderPassLibrary } from './backend/pass/library';
import { DeviceQuantizeMode } from './post/device_quantize/mode';
import { RenderGraphRuntime, buildFrameData, updateExternalFrameTiming } from './graph/graph';
import type {
	GameViewHost,
	GameViewCanvas,
	SubscriptionHandle,
} from '../platform';
import type { GxGpu } from '../machine/devices/gx/gpu';
import type { GxGpuCommandBufferView, GxGpuReadbackPortView } from '../machine/devices/gx/gpu_command_buffer';
import { renderGate } from '../common/taskgate';

const PRESENTATION_PASS_IDS = ['gx_gpu', 'device_quantize', 'presentation_history_a', 'presentation_history_b', 'crt', 'host_overlay', 'host_menu'];

interface GameViewOpts {
	host: GameViewHost;
	viewportSize: vec2; // Native machine scanout size.
}

export class GameView implements RenderContext {
	public dispose(): void {
		if (this.renderGraph) {
			this.renderGraph.dispose();
			this.renderGraph = null;
		}
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

	public viewportSize: vec2;
	public viewportScale = 1;
	public canvasSize: vec2;
	public canvasScale = 1;

	private _nativeCtx: BackendContext = null; // The underlying native rendering context.
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
	public offscreenCanvasSize!: vec2;
	public textures: { [k: string]: TextureHandle } = {};
	public gxGpuCommandBuffer!: GxGpuCommandBufferView;
	public gxGpuReadbackPort!: GxGpuReadbackPortView;
	public gxGpuStatusWord = 0;
	public gxGpuDisplayModeWord = 0;
	public gxGpuDisplayStartWord = 0;
	public gxGpuHorizontalDisplayRangeWord = 0;
	public gxGpuVerticalDisplayRangeWord = 0;
	public gxGpuVramSnapshotBytes!: Uint8Array;
	public gxGpuVramSnapshotSerial = 0;
	public pipelineRegistry?: RenderPassLibrary;
	private presentationEnabled = true;
	// CRT/post flags (used by passes)
	public enable_noise = true;
	public enable_colorbleed = true;
	public enable_scanlines = true;
	public enable_blur = true;
	public enable_glow = true;
	public enable_fringing = true;
	public enable_aperture = false; // Whether to apply an aperture mask in the CRT shader; This is a stylistic choice that can be toggled independently of the other CRT effects
	public show_resource_usage_gizmo = false;
	public deviceQuantizeMode: DeviceQuantizeMode = DeviceQuantizeMode.None;
	public noiseIntensity = 0.3;
	public colorBleed: [number, number, number] = [0.02, 0.0, 0.0];
	public blurIntensity = 0.6;
	public glowColor: [number, number, number] = [0.12, 0.10, 0.09];
	public crt_postprocessing_enabled = true; // Whether to apply postprocessing in the CRT-shader, such as scanlines, noise, glow, etc.

	public viewportTypeIde: 'viewport' | 'offscreen' = 'viewport';
	public presentationMode: PresentationMode = 'completed';
	public commitPresentationFrame = false;
	public presentationHistorySourceIndex: 0 | 1 = 0;
	private renderFrameIndex = 0;
	private lastRenderTimeSeconds = 0;

	public applyPresentationPassState(): void {
		const registry = this.pipelineRegistry;
		if (!registry) {
			return;
		}
		for (let index = 0; index < PRESENTATION_PASS_IDS.length; index += 1) {
			registry.setPassEnabled(PRESENTATION_PASS_IDS[index], this.presentationEnabled);
		}
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
		this.viewportSize = { x: opts.viewportSize.x, y: opts.viewportSize.y };
		this.canvasSize = { x: opts.viewportSize.x, y: opts.viewportSize.y };
		this.offscreenCanvasSize = { x: opts.viewportSize.x, y: opts.viewportSize.y };
		this.lastRenderTimeSeconds = machineManager.platform.clock.now() / 1000;
		renderGate.begin({ blocking: true, category: 'init', tag: 'init' }); // Note that we don't store the token; We can end the scope by calling renderGate.end() without a token, assuming that the category is unique fot init. It means that we can safely end the scope later without worrying about late resolves or lifecycle issues.
	}

	public setRenderTargetSize(width: number, height: number): void {
		if (this.viewportSize.x === width && this.viewportSize.y === height) {
			return;
		}
		this.viewportSize.x = width;
		this.viewportSize.y = height;
		this.canvasSize.x = width;
		this.canvasSize.y = height;
		this.offscreenCanvasSize.x = width;
		this.offscreenCanvasSize.y = height;
		this.surface.setRenderTargetSize(width, height);
		const dimensions = this.host.getSize(this.viewportSize, this.canvasSize);
		this.viewportScale = dimensions.viewportScale;
		this.canvasScale = dimensions.canvasScale;
		this.resetPresentationHistory();
		this.rebuildGraph();
	}

	public init(): void {
		this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		// Backend resources are configured externally via setBackend()
		this.rebuildGraph();
		renderGate.endCategory('init'); // End the init scope without a token, assuming the category is unique for init.
	}

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
			const nowSeconds = machineManager.platform.clock.now() / 1000;
			updateExternalFrameTiming(this.renderFrameIndex, nowSeconds, nowSeconds - this.lastRenderTimeSeconds);
			this.renderFrameIndex += 1;
			this.lastRenderTimeSeconds = nowSeconds;
			const frame = buildFrameData();
			renderGraph.execute(frame);
			this.finalizePresentation();
		} finally {
			backend.endFrame();
			renderGate.end(token);
		}
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
		if (!controller) {
			return false;
		}
		return controller.isFullscreen();
	}

	public static get fullscreenEnabled(): boolean {
		const view = machineManager.view;
		if (!view) {
			throw new Error('[GameView] View not available while checking fullscreen support.');
		}
		const controller = view.host.getCapability('display-mode');
		if (!controller) {
			return false;
		}
		return controller.isSupported();
	}

	public static async triggerFullScreenOnFakeUserEvent(): Promise<void> {
		const view = machineManager.view;
		if (!view) {
			throw new Error('[GameView] View not available while entering fullscreen.');
		}
		if (GameView.fullscreenEnabled) {
			try {
				machineManager.paused = true;
				const controller = view.host.getCapability('display-mode')!;
				await controller.setFullscreen(true);
			}
			catch (error) {
				console.error(error);
			}
			finally {
				machineManager.paused = false;
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
		const view = machineManager.view;
		if (!view) {
			throw new Error('[GameView] View not available while exiting fullscreen.');
		}
		if (GameView.fullscreenEnabled) {
			try {
				machineManager.paused = true;
				const controller = view.host.getCapability('display-mode')!;
				await controller.setFullscreen(false);
			}
			catch (error) {
				// NOTE: Historical bug reports mentioned debugger interactions triggering failures here.
				console.error(error);
			}
			finally {
				machineManager.paused = false;
			}
		}
		if (GameView.windowedKeyListenerUnsub) {
			GameView.windowedKeyListenerUnsub.unsubscribe();
			GameView.windowedKeyListenerUnsub = null;
		}
	}

	public showFadingOverlay(text: string): void {
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

	public hideFadingOverlay(): void {
		const overlays = this.host.getCapability('overlay');
		if (!overlays) return;
		const overlay = overlays.getOverlay('pause-overlay');
		if (!overlay) return;
		overlay.addClass('fade-out');
		overlay.removeClass('visible');
		overlay.forceReflow();
		overlay.onAnimationEnd(() => {
			overlay.removeClass('fade-out');
			overlay.remove();
		});
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

	public captureGxGpuVramSnapshot(gxGpu: GxGpu): void | Promise<void> {
		return this.backend.captureGxGpuVramSnapshot(gxGpu);
	}

	public async initializeDefaultTextures(): Promise<void> {
		// Default material textures for imported model assets
		this.textures['_default_albedo'] = this.backend.createSolidTexture2D(1, 1, 0xffffffff, RGBA8_SRGB_TEXTURE_PARAMS);
		// Normal map default (0.5,0.5,1.0)
		this.textures['_default_normal'] = this.backend.createSolidTexture2D(1, 1, 0xff7f7fff, RGBA8_LINEAR_TEXTURE_PARAMS);
		// Metallic/Roughness default: neutral (mr.g=1 keeps roughnessFactor, mr.b=1 keeps metallicFactor)
		this.textures['_default_mr'] = this.backend.createSolidTexture2D(1, 1, 0xffffffff, RGBA8_LINEAR_TEXTURE_PARAMS);
	}

	// (single handleResize implementation above in the class)

	public rebuildGraph(): void {
		const token = renderGate.begin({ blocking: true, category: 'rebuild_graph', tag: 'frame' });
		if (!this.pipelineRegistry) {
			renderGate.end(token);
			throw new Error('[GameView] PipelineRegistry not configured before rebuildGraph.');
		}
		this.resetPresentationHistory();
		if (this.renderGraph) {
			this.renderGraph.dispose();
		}
		// GameView implements RenderContext directly
		this.renderGraph = this.pipelineRegistry.buildRenderGraph();
		renderGate.end(token);
	}

}
