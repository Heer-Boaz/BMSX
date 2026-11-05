import { BFont } from './shared/bitmap_font';
import type { vec2 } from '../common/vector';
import type { BackendContext, GPUBackend, PresentationMode, TextureHandle } from './backend/backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS, RGBA8_SRGB_TEXTURE_PARAMS } from './backend/texture_params';
import { RenderPassLibrary } from './backend/pass/library';
import { DeviceQuantizeMode } from './post/device_quantize/mode';
import { RenderGraphRuntime, type FrameData } from './graph/graph';
import {
	DisplayPointMappingResult,
	mapDisplayPointToViewport,
	type VideoOutput,
} from './video_output';
import type { GxGpuDeviceOutput } from '../machine/devices/gx/device_output';
import { HostOverlayQueue } from './host_overlay/overlay_queue';
import type { RgbaImage } from './image';
import type { RectBounds } from '../common/rect';

/** Published completed image only; held/partial repaints do not notify. */
export type GameFrameObserver = { committed(sequence: number): void };

export class VideoPresenter {
	private gameFrameObserver: GameFrameObserver | null = null;
	public accessor default_font: BFont;
	/** Selected logical size for the next composition. */
	public readonly viewportSize: vec2;
	public readonly visibleViewportBounds: Readonly<RectBounds>;
	/** Allocated backing-buffer size; changes only when presenting. */
	public readonly canvasSize: vec2;
	public readonly nativeCtx: BackendContext;
	public readonly backend: GPUBackend;
	/** Native PCRTC source size, independent of the host presentation surface. */
	public offscreenCanvasSize: vec2;
	public textures: { [k: string]: TextureHandle } = {};
	public readonly hostOverlayQueue = new HostOverlayQueue();

	public enable_noise = true;
	public enable_colorbleed = true;
	public enable_scanlines = true;
	public enable_blur = true;
	public enable_glow = true;
	public enable_fringing = true;
	public enable_aperture = false;
	public show_resource_usage_gizmo = false;
	public noiseIntensity = 0.3;
	public colorBleed: [number, number, number] = [0.02, 0.0, 0.0];
	public blurIntensity = 0.6;
	public glowColor: [number, number, number] = [0.12, 0.10, 0.09];
	public crt_postprocessing_enabled = true;

	public presentationMode: PresentationMode = 'completed';
	public commitPresentationFrame = false;
	public presentationHistorySourceIndex: 0 | 1 = 0;

	private renderGraph!: RenderGraphRuntime;
	private pipelineRegistry!: RenderPassLibrary;
	private readonly frame: FrameData = { frameIndex: 0, time: 0, delta: 0 };
	private _deviceQuantizeMode = DeviceQuantizeMode.None;
	private _deviceQuantizeConfigurationRevision = 0;
	private fixedRenderTargetSize = false;
	private committedSequence: number | undefined;

	constructor(private readonly output: VideoOutput, backend: GPUBackend, viewportWidth: number, viewportHeight: number) {
		this.backend = backend;
		this.nativeCtx = backend.context;
		this.viewportSize = { x: viewportWidth, y: viewportHeight };
		this.visibleViewportBounds = output.visibleViewportBounds;
		this.canvasSize = { x: viewportWidth, y: viewportHeight };
		this.offscreenCanvasSize = { x: viewportWidth, y: viewportHeight };
	}

	public get deviceQuantizeMode(): DeviceQuantizeMode {
		return this._deviceQuantizeMode;
	}

	public set deviceQuantizeMode(mode: DeviceQuantizeMode) {
		if (this._deviceQuantizeMode === mode) return;
		this._deviceQuantizeMode = mode;
		this._deviceQuantizeConfigurationRevision += 1;
	}

	public get deviceQuantizeConfigurationRevision(): number {
		return this._deviceQuantizeConfigurationRevision;
	}

	public get presentationHistoryDestinationIndex(): 0 | 1 {
		return this.presentationHistorySourceIndex === 0 ? 1 : 0;
	}

	public get presentationSequence(): number {
		return this.frame.frameIndex;
	}

	public setGameFrameObserver(observer: GameFrameObserver | null): void { this.gameFrameObserver = observer; }

	public get gameFrameSequence(): number | undefined { return this.committedSequence; }

	public captureGameFrame(): Promise<RgbaImage> {
		if (this.committedSequence === undefined) throw new Error('No completed game frame is available.');
		return this.renderGraph.captureColorTexture(this.pipelineRegistry.frameHistoryHandles[this.presentationHistorySourceIndex]);
	}

	public initialize(pipelineRegistry: RenderPassLibrary): void {
		this.pipelineRegistry = pipelineRegistry;
		this.resetPresentationHistory();
		this._deviceQuantizeConfigurationRevision += 1;
		this.renderGraph = this.pipelineRegistry.buildRenderGraph();
	}

	public dispose(): void {
		this.renderGraph.dispose();
		this.pipelineRegistry.dispose();
		this.clearTextures();
	}

	/** Machine output can change while a host surface owns the presentation size. */
	public setScanoutSize(width: number, height: number): void {
		if (!this.fixedRenderTargetSize) {
			this.viewportSize.x = width;
			this.viewportSize.y = height;
		}
		if (this.offscreenCanvasSize.x === width && this.offscreenCanvasSize.y === height) return;
		this.offscreenCanvasSize.x = width;
		this.offscreenCanvasSize.y = height;
		this.rebuildGraph();
	}

	public setFixedRenderTargetSize(width: number, height: number): void {
		this.fixedRenderTargetSize = true;
		this.viewportSize.x = width;
		this.viewportSize.y = height;
	}

	public useScanoutRenderTargetSize(): void {
		this.fixedRenderTargetSize = false;
		this.viewportSize.x = this.offscreenCanvasSize.x;
		this.viewportSize.y = this.offscreenCanvasSize.y;
	}

	public mapDisplayPointToViewport(screenX: number, screenY: number, target: vec2): boolean {
		return mapDisplayPointToViewport(
			this.output.measureDisplay(),
			this.canvasSize.x,
			this.canvasSize.y,
			screenX,
			screenY,
			target,
		) === DisplayPointMappingResult.Inside;
	}

	public present(output: GxGpuDeviceOutput, timeSeconds: number, deltaSeconds: number): void {
		// Size requests may arrive between frames. Allocate only when the new
		// target will actually be drawn, retaining the old image in the meantime.
		const width = this.viewportSize.x, height = this.viewportSize.y;
		if (this.canvasSize.x !== width || this.canvasSize.y !== height) {
			this.backend.resizePresentationTarget(width, height);
			this.canvasSize.x = width;
			this.canvasSize.y = height;
			this.output.setDisplaySize(width, height);
		}
		this.backend.beginFrame();
		try {
			this.frame.time = timeSeconds;
			this.frame.delta = deltaSeconds;
			this.renderGraph.execute(this.frame, output);
			this.frame.frameIndex = (this.frame.frameIndex + 1) >>> 0;
			this.finalizePresentation();
		} finally {
			this.backend.endFrame();
		}
	}

	public clearTextures(): void {
		for (const name in this.textures) {
			this.backend.destroyTexture(this.textures[name]);
		}
		this.textures = {};
	}

	public initializeDefaultTextures(): void {
		this.clearTextures();
		this.textures['_default_albedo'] = this.backend.createSolidTexture2D(1, 1, 0xffffffff, RGBA8_SRGB_TEXTURE_PARAMS);
		this.textures['_default_normal'] = this.backend.createSolidTexture2D(1, 1, 0xff7f7fff, RGBA8_LINEAR_TEXTURE_PARAMS);
		this.textures['_default_mr'] = this.backend.createSolidTexture2D(1, 1, 0xffffffff, RGBA8_LINEAR_TEXTURE_PARAMS);
	}

	public configurePresentation(mode: PresentationMode, commitFrame: boolean): void {
		this.presentationMode = mode;
		this.commitPresentationFrame = commitFrame;
	}

	public rebuildGraph(): void {
		this.renderGraph.dispose();
		this.resetPresentationHistory();
		this._deviceQuantizeConfigurationRevision += 1;
		this.renderGraph = this.pipelineRegistry.buildRenderGraph();
	}

	private resetPresentationHistory(): void {
		this.committedSequence = undefined;
		this.presentationMode = 'completed';
		this.commitPresentationFrame = false;
		this.presentationHistorySourceIndex = 0;
	}

	private finalizePresentation(): void {
		if (!this.commitPresentationFrame) {
			return;
		}
		this.presentationHistorySourceIndex = this.presentationHistoryDestinationIndex;
		this.committedSequence = this.frame.frameIndex;
		this.gameFrameObserver?.committed(this.committedSequence);
	}
}
