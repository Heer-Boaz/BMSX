import type { RenderPassLibrary } from '../backend/pass/library';
import type { GxGpuPipelineState, HostOverlayPipelineState, RenderPassStateRegistry } from '../backend/backend';
import type { HeadlessVideoOutput } from './video_output';
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
			exec: (backend) => {
				presentHeadlessFrame(output, backend as HeadlessGPUBackend);
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
			(backend as HeadlessGPUBackend).resizeFramebuffer(registry.presenter.offscreenCanvasSize.x, registry.presenter.offscreenCanvasSize.y);
		},
	});
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
			const headless = backend as HeadlessGPUBackend;
			renderGxGpuSoftwareFrame(headless.gxGpuSoftware, state, output, headless.framebufferWords);
		},
	});
}

export function drawHeadlessHostMenuLayer(backend: HeadlessGPUBackend, frame: HostMenuPipelineState): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(backend.glyphContext, backend.framebufferPixels, backend.framebufferWidth, backend.framebufferHeight, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

export function drawHeadlessHostOverlayFrame(backend: HeadlessGPUBackend, frame: HostOverlayPipelineState): void {
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(backend.glyphContext, backend.framebufferPixels, backend.framebufferWidth, backend.framebufferHeight, frame.commandKinds[index], frame.commandRefs[index]);
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
		exec: (backend, _fbo, state: RenderPassStateRegistry['device_quantize']) => {
			const headless = backend as HeadlessGPUBackend;
			applyHeadlessDeviceQuantize(headless.framebufferPixels, headless.framebufferWidth, headless.framebufferHeight, state.luts);
		},
	});
}

function presentHeadlessFrame(output: HeadlessVideoOutput, backend: HeadlessGPUBackend): void {
	const frame = backend.presentedFrameBuffer;
	frame.pixels = backend.framebufferPixels;
	frame.width = backend.framebufferWidth;
	frame.height = backend.framebufferHeight;
	output.presentFrameBuffer(frame);
}
