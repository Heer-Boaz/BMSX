import type { RenderPassLibrary } from '../backend/pass/library';
import type { Framebuffer2DPipelineState, GxGpuPipelineState, RenderPassDef } from '../backend/backend';
import type { GameView } from '../gameview';
import type { Host2DSubmission } from '../shared/submissions';
import { RGBA8_SRGB_TEXTURE_PARAMS } from '../backend/texture_params';
import type { HeadlessPresentHost, HeadlessPresentedFrameBuffer } from './view';
import { hostOverlayMenu } from '../../core/host_overlay_menu';
import { renderHeadlessHost2DEntry, renderHeadlessHost2DSubmission } from './host_2d';
import { renderGxGpuSoftwareFrame } from '../backend/software/gx_gpu';
import { renderVdpRpuSoftwareFrame } from '../backend/software/vdp_rpu';
import { applyHeadlessDeviceQuantize } from '../post/device_quantize/headless/pipeline';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerHeadlessGxGpuPass(registry);
	registerHeadlessRpuPass(registry);
	registerFrameBuffer2DPass(registry);
	registerHeadlessDeviceQuantizePass(registry);
}

export function registerHeadlessPresentPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'headless_present',
		name: 'HeadlessPresent',
		stateOnly: true,
		graph: { reads: ['frame_color'] },
		exec: () => {
			presentHeadlessFrame(registry.view as GameView);
		},
	});
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({
		id: 'frame_resolve',
		name: 'HeadlessFrameResolve',
		stateOnly: true,
		graph: { skip: true },
		exec: () => {
			const view = registry.view as GameView;
			commitHeadlessFrame(view.vdpFrameBufferTextures.width(), view.vdpFrameBufferTextures.height(), view.canvasSize.x, view.canvasSize.y);
		},
	});
	registry.register({ id: 'frame_shared', name: 'HeadlessFrameShared', stateOnly: true, graph: { skip: true }, exec: () => { /* noop */ } });
}

let headlessCompositePixels = new Uint8Array(0);
let headlessFrameWidth = 0;
let headlessFrameHeight = 0;
let headlessPresentWidth = 0;
let headlessPresentHeight = 0;
let previousFrameBufferHeadline = '';
let previousRpuHeadline = '';
const headlessPresentedFrameBuffer: HeadlessPresentedFrameBuffer = {
	pixels: headlessCompositePixels,
	srcWidth: 0,
	srcHeight: 0,
	dstWidth: 0,
	dstHeight: 0,
};

function resizeHeadlessFrame(width: number, height: number): void {
	const byteLength = width * height * 4;
	if (headlessCompositePixels.byteLength !== byteLength) {
		headlessCompositePixels = new Uint8Array(byteLength);
	}
	headlessFrameWidth = width;
	headlessFrameHeight = height;
}

function emitHeadlessHeadline(label: string, previous: string, current: string): string {
	if (previous !== current) {
		console.log(`[headless:${label}] ${current} (1 changes)`);
	}
	return current;
}

function commitHeadlessFrame(frameBufferWidth: number, frameBufferHeight: number, presentWidth: number, presentHeight: number): void {
	resizeHeadlessFrame(frameBufferWidth, frameBufferHeight);
	headlessPresentWidth = presentWidth;
	headlessPresentHeight = presentHeight;
}

function fillHeadlessFrame(width: number, height: number): void {
	resizeHeadlessFrame(width, height);
	headlessCompositePixels.fill(0);
	for (let offset = 3; offset < headlessCompositePixels.length; offset += 4) {
		headlessCompositePixels[offset] = 255;
	}
}

function countHeadlessActivePixels(): number {
	let active = 0;
	for (let index = 3; index < headlessCompositePixels.length; index += 4) {
		if (headlessCompositePixels[index] !== 0) {
			active += 1;
		}
	}
	return active;
}

function registerHeadlessGxGpuPass(registry: RenderPassLibrary): void {
	registry.register<GxGpuPipelineState>({
		id: 'gx_gpu',
		name: 'HeadlessGXGPU',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		prepare: () => {
			const view = registry.view as GameView;
			registry.setState('gx_gpu', {
				width: view.offscreenCanvasSize.x,
				height: view.offscreenCanvasSize.y,
				commandBuffer: view.gxGpuCommandBuffer,
				statusWord: view.gxGpuStatusWord,
				displayModeWord: view.gxGpuDisplayModeWord,
				displayStartWord: view.gxGpuDisplayStartWord,
				horizontalDisplayRangeWord: view.gxGpuHorizontalDisplayRangeWord,
				verticalDisplayRangeWord: view.gxGpuVerticalDisplayRangeWord,
			});
		},
		exec: (_backend, _fbo, state) => {
			const view = registry.view as GameView;
			const width = view.offscreenCanvasSize.x;
			const height = view.offscreenCanvasSize.y;
			resizeHeadlessFrame(width, height);
			renderGxGpuSoftwareFrame(state, headlessCompositePixels, width, height);
			commitHeadlessFrame(width, height, view.canvasSize.x, view.canvasSize.y);
		},
	});
}

function registerHeadlessRpuPass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'vdp_rpu',
		name: 'HeadlessRPU',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: (view) => view.vdpRpuFrame.commands.passCount !== 0 && view.gxGpuCommandBuffer.commandCount === 0,
		exec: () => {
			const view = registry.view as GameView;
			const frame = view.vdpRpuFrame;
			const width = view.offscreenCanvasSize.x;
			const height = view.offscreenCanvasSize.y;
			fillHeadlessFrame(width, height);
			renderVdpRpuSoftwareFrame(frame, headlessCompositePixels, width, height);
			commitHeadlessFrame(width, height, view.canvasSize.x, view.canvasSize.y);
			const headline = `pixels=${headlessCompositePixels.length >> 2} active=${countHeadlessActivePixels()} framebuffer=${width}x${height} present=${view.canvasSize.x}x${view.canvasSize.y} passes=${frame.commands.passCount}`;
			previousRpuHeadline = emitHeadlessHeadline('rpu', previousRpuHeadline, headline);
		},
	});
}

export function drawHeadlessHostMenuLayer(): void {
	const count = hostOverlayMenu.queuedCommandCount();
	for (let index = 0; index < count; index += 1) {
		renderHeadlessHost2DEntry(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, hostOverlayMenu.commandKind(index), hostOverlayMenu.commandRef(index));
	}
}

export function drawHeadlessHostOverlayFrame(commands: readonly Host2DSubmission[]): void {
	for (let index = 0; index < commands.length; index += 1) {
		renderHeadlessHost2DSubmission(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, commands[index]);
	}
}

function registerHeadlessDeviceQuantizePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'HeadlessDeviceQuantize',
		stateOnly: true,
		graph: { reads: ['frame_color'], writes: ['device_color'] },
		shouldExecute: (view) => view.dither_type !== 0,
		exec: () => {
			const view = registry.view as GameView;
			applyHeadlessDeviceQuantize(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, view.dither_type);
		},
	});
}

function presentHeadlessFrame(view: GameView): void {
	for (let offset = 3; offset < headlessCompositePixels.length; offset += 4) {
		headlessCompositePixels[offset] = 255;
	}
	const host = view.host as unknown as HeadlessPresentHost;
	headlessPresentedFrameBuffer.pixels = headlessCompositePixels;
	headlessPresentedFrameBuffer.srcWidth = headlessFrameWidth;
	headlessPresentedFrameBuffer.srcHeight = headlessFrameHeight;
	headlessPresentedFrameBuffer.dstWidth = headlessPresentWidth;
	headlessPresentedFrameBuffer.dstHeight = headlessPresentHeight;
	host.presentFrameBuffer(headlessPresentedFrameBuffer);
}

function registerFrameBuffer2DPass(registry: RenderPassLibrary): void {
	const pass: RenderPassDef<Framebuffer2DPipelineState> = {
		id: 'framebuffer_2d',
		name: 'HeadlessFramebuffer2D',
		stateOnly: true,
		graph: { writes: ['frame_color'] },
		shouldExecute: (view) => view.presentWorkbenchFrameBufferTexture && view.vdpRpuFrame.commands.passCount === 0,
		prepare: () => {
			const view = registry.view as GameView;
			registry.setState('framebuffer_2d', {
				width: view.canvasSize.x,
				height: view.canvasSize.y,
				baseWidth: view.viewportSize.x,
				baseHeight: view.viewportSize.y,
				colorTex: view.vdpFrameBufferTextures.displayTexture(),
			} as Framebuffer2DPipelineState);
		},
		exec: (backend, _fbo, state: Framebuffer2DPipelineState) => {
			const view = registry.view as GameView;
			const frameBufferWidth = view.vdpFrameBufferTextures.width();
			const frameBufferHeight = view.vdpFrameBufferTextures.height();
			resizeHeadlessFrame(frameBufferWidth, frameBufferHeight);
			backend.readTextureRegion(state.colorTex, headlessCompositePixels, frameBufferWidth, frameBufferHeight, 0, 0, RGBA8_SRGB_TEXTURE_PARAMS);
			commitHeadlessFrame(frameBufferWidth, frameBufferHeight, state.width, state.height);
			const headline = `pixels=${headlessCompositePixels.length >> 2} active=${countHeadlessActivePixels()} framebuffer=${frameBufferWidth}x${frameBufferHeight} present=${state.width}x${state.height} logical=${state.baseWidth}x${state.baseHeight}`;
			previousFrameBufferHeadline = emitHeadlessHeadline('framebuffer', previousFrameBufferHeadline, headline);
		},
	};
	registry.register(pass);
}
