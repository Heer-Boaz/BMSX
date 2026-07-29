import { BFont } from './shared/bitmap_font';
import type { vec2 } from '../common/vector';
import type { BackendContext, GPUBackend, PresentationMode, RenderContext, TextureHandle } from './backend/backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS, RGBA8_SRGB_TEXTURE_PARAMS } from './backend/texture_params';
import { RenderPassLibrary } from './backend/pass/library';
import { DeviceQuantizeMode } from './post/device_quantize/mode';
import { RenderGraphRuntime, type FrameData } from './graph/graph';
import type { VideoOutput, VideoSurface } from '../platform';
import type { GxGpuDeviceOutput } from '../machine/devices/gx/device_output';
import { renderGate } from '../common/taskgate';

export class VideoPresenter implements RenderContext {
	public readonly surface: VideoSurface;
	public accessor default_font: BFont;
	public viewportSize: vec2;
	public viewportScale = 1;
	public canvasSize: vec2;
	public canvasScale = 1;
	public readonly nativeCtx: BackendContext;
	public readonly backend: GPUBackend;
	public offscreenCanvasSize: vec2;
	public textures: { [k: string]: TextureHandle } = {};

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

	constructor(private readonly output: VideoOutput, backend: GPUBackend, viewportWidth: number, viewportHeight: number) {
		this.surface = output.surface;
		this.backend = backend;
		this.nativeCtx = backend.context;
		this.viewportSize = { x: viewportWidth, y: viewportHeight };
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

	public initialize(pipelineRegistry: RenderPassLibrary): void {
		this.pipelineRegistry = pipelineRegistry;
		this.surface.setRenderTargetSize(this.canvasSize.x, this.canvasSize.y);
		this.resetPresentationHistory();
		this._deviceQuantizeConfigurationRevision += 1;
		this.renderGraph = this.pipelineRegistry.buildRenderGraph();
	}

	public dispose(): void {
		this.renderGraph.dispose();
		this.pipelineRegistry.dispose();
		this.clearTextures();
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
		const dimensions = this.output.getSize(this.viewportSize, this.canvasSize);
		this.viewportScale = dimensions.viewportScale;
		this.canvasScale = dimensions.canvasScale;
		this.rebuildGraph();
	}

	public present(output: GxGpuDeviceOutput, timeSeconds: number, deltaSeconds: number): void {
		if (!renderGate.ready) return;
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
}
