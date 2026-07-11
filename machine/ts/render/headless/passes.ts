import type { RenderPassLibrary } from '../backend/pass/library';
import type { GxGpuPipelineState } from '../backend/backend';
import type { GameView } from '../gameview';
import type { Host2DSubmission } from '../shared/submissions';
import type { HeadlessPresentHost, HeadlessPresentedFrameBuffer } from './view';
import { hostOverlayMenu } from '../../core/host_overlay_menu';
import { renderHeadlessHost2DEntry, renderHeadlessHost2DSubmission } from './host_2d';
import { renderGxGpuSoftwareFrame } from '../backend/software/gx_gpu';
import { applyHeadlessDeviceQuantize } from '../post/device_quantize/headless/pipeline';
import { DeviceQuantizeMode } from '../post/device_quantize/mode';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerHeadlessGxGpuPass(registry);
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
			commitHeadlessFrame(view.offscreenCanvasSize.x, view.offscreenCanvasSize.y, view.canvasSize.x, view.canvasSize.y);
		},
	});
}

let headlessCompositePixels = new Uint8Array(0);
let headlessFrameWidth = 0;
let headlessFrameHeight = 0;
let headlessPresentWidth = 0;
let headlessPresentHeight = 0;
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

function commitHeadlessFrame(frameBufferWidth: number, frameBufferHeight: number, presentWidth: number, presentHeight: number): void {
	resizeHeadlessFrame(frameBufferWidth, frameBufferHeight);
	headlessPresentWidth = presentWidth;
	headlessPresentHeight = presentHeight;
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
				vramSnapshotBytes: view.gxGpuVramSnapshotBytes,
				vramSnapshotSerial: view.gxGpuVramSnapshotSerial,
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
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		exec: () => {
			const view = registry.view as GameView;
			applyHeadlessDeviceQuantize(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, view.deviceQuantizeMode);
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
