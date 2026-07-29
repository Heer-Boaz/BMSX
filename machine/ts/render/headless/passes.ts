import type { RenderPassLibrary } from '../backend/pass/library';
import type { GxGpuPipelineState, HostOverlayPipelineState, RenderPassStateRegistry } from '../backend/backend';
import type { HeadlessPresentedFrameBuffer, HeadlessVideoOutput } from './video_output';
import type { HostMenuPipelineState } from '../backend/backend';
import { renderHeadlessHost2DEntry } from './host_2d';
import { renderGxGpuSoftwareFrame } from '../backend/software/gx_gpu';
import { applyHeadlessDeviceQuantize } from '../post/device_quantize/headless/pipeline';
import { DeviceQuantizeMode } from '../post/device_quantize/mode';
import { createDeviceQuantizeState, writeDeviceQuantizeState } from '../post/device_quantize/state';
import type { HeadlessGPUBackend } from './backend';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerFramePasses(registry);
	registerHeadlessGxGpuPass(registry);
	registerHeadlessDeviceQuantizePass(registry);
}

export function registerHeadlessPresentPass(registry: RenderPassLibrary, output: HeadlessVideoOutput): void {
	registry.register({
		id: 'headless_present',
		name: 'HeadlessPresent',
			stateOnly: true,
			graph: { reads: ['frame_color'] },
			exec: () => {
				presentHeadlessFrame(output);
		},
	});
}

function registerFramePasses(registry: RenderPassLibrary): void {
	registry.register({
		id: 'frame_resolve',
		name: 'HeadlessFrameResolve',
		stateOnly: true,
		graph: { skip: true },
		exec: (backend) => {
			resizeHeadlessFrame(backend as HeadlessGPUBackend, registry.presenter.offscreenCanvasSize.x, registry.presenter.offscreenCanvasSize.y);
		},
	});
}

let headlessCompositePixels = new Uint8Array(0);
let headlessCompositeWords = new Uint32Array(0);
let headlessFrameWidth = 0;
let headlessFrameHeight = 0;
const headlessPresentedFrameBuffer: HeadlessPresentedFrameBuffer = {
	pixels: headlessCompositePixels,
	width: 0,
	height: 0,
};

function resizeHeadlessFrame(backend: HeadlessGPUBackend, width: number, height: number): void {
	const byteLength = width * height * 4;
	if (headlessCompositePixels.byteLength !== byteLength) {
		const buffer = new ArrayBuffer(byteLength);
		headlessCompositePixels = new Uint8Array(buffer);
		headlessCompositeWords = new Uint32Array(buffer);
	}
	headlessFrameWidth = width;
	headlessFrameHeight = height;
	backend.resizeFramebuffer(width, height);
}

function registerHeadlessGxGpuPass(registry: RenderPassLibrary): void {
	const state: GxGpuPipelineState = {
		width: 0,
		height: 0,
	};
	registry.register<GxGpuPipelineState>({
		id: 'gx_gpu',
		name: 'HeadlessGXGPU',
		stateOnly: true,
		initialState: state,
		graph: {
			writes: ['frame_color'],
			writeState: (ctx, gxGpuState) => {
				gxGpuState.width = ctx.presenter.offscreenCanvasSize.x;
				gxGpuState.height = ctx.presenter.offscreenCanvasSize.y;
			},
		},
		exec: (backend, _fbo, state, _pipelineHandle, output) => {
			renderGxGpuSoftwareFrame((backend as HeadlessGPUBackend).gxGpuSoftware, state, output, headlessCompositeWords);
		},
	});
}

export function drawHeadlessHostMenuLayer(frame: HostMenuPipelineState): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

export function drawHeadlessHostOverlayFrame(frame: HostOverlayPipelineState): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

function registerHeadlessDeviceQuantizePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'HeadlessDeviceQuantize',
		stateOnly: true,
		initialState: createDeviceQuantizeState(),
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			writeState: writeDeviceQuantizeState,
		},
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		exec: (_backend, _fbo, state: RenderPassStateRegistry['device_quantize']) => {
			applyHeadlessDeviceQuantize(headlessCompositePixels, headlessFrameWidth, headlessFrameHeight, state.luts);
		},
	});
}

function presentHeadlessFrame(output: HeadlessVideoOutput): void {
	headlessPresentedFrameBuffer.pixels = headlessCompositePixels;
	headlessPresentedFrameBuffer.width = headlessFrameWidth;
	headlessPresentedFrameBuffer.height = headlessFrameHeight;
	output.presentFrameBuffer(headlessPresentedFrameBuffer);
}
