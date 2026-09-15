import type { RenderPassLibrary } from '../backend/pass/library';
import type { GxGpuPipelineState, HeadlessRenderTargetHandle, HostOverlayPipelineState, RenderPassStateRegistry } from '../backend/backend';
import type { HostMenuPipelineState } from '../backend/backend';
import { beginHeadlessHost2D, renderHeadlessHost2DEntry } from './host_2d';
import { renderGxGpuSoftwareFrame } from '../backend/software/gx_gpu';
import { applyHeadlessDeviceQuantize } from '../post/device_quantize/headless/pipeline';
import { DeviceQuantizeMode } from '../post/device_quantize/mode';
import { createDeviceQuantizeState, writeDeviceQuantizeState } from '../post/device_quantize/state';
import type { HeadlessGPUBackend } from './backend';
import { registerPresentationPasses } from '../post/crt/headless/pipeline';

export function registerHeadlessPasses(registry: RenderPassLibrary): void {
	registerHeadlessGxGpuPass(registry);
	registerHeadlessDeviceQuantizePass(registry);
	registerPresentationPasses(registry);
}

function registerHeadlessGxGpuPass(registry: RenderPassLibrary): void {
	const state: GxGpuPipelineState = {
		width: 0,
		height: 0,
	};
	registry.register<GxGpuPipelineState>({
		id: 'gx_gpu',
		name: 'HeadlessGXGPU',
		initialState: state,
		graph: {
			writes: ['frame_color'],
			writeState: (ctx, gxGpuState) => {
				gxGpuState.width = ctx.presenter.offscreenCanvasSize.x;
				gxGpuState.height = ctx.presenter.offscreenCanvasSize.y;
			},
		},
		exec: (backend, fbo, state, _pipelineHandle, output) => {
			const headless = backend as HeadlessGPUBackend;
			headless.activateRenderTarget(fbo as HeadlessRenderTargetHandle);
			renderGxGpuSoftwareFrame(headless.gxGpuSoftware, state, output, headless.framebufferWords);
		},
	});
}

export function drawHeadlessHostMenuLayer(backend: HeadlessGPUBackend, frame: HostMenuPipelineState): void {
	backend.activateDefaultRenderTarget();
	beginHeadlessHost2D(backend.hostOverlayContext, backend.framebufferPixels, backend.framebufferWidth, backend.framebufferHeight);
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(backend.hostOverlayContext, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

export function drawHeadlessHostOverlayFrame(backend: HeadlessGPUBackend, frame: HostOverlayPipelineState): void {
	backend.activateDefaultRenderTarget();
	beginHeadlessHost2D(backend.hostOverlayContext, backend.framebufferPixels, backend.framebufferWidth, backend.framebufferHeight);
	for (let index = 0; index < frame.commandCount; index += 1) {
		renderHeadlessHost2DEntry(backend.hostOverlayContext, frame.commandKinds[index], frame.commandRefs[index]);
	}
}

function registerHeadlessDeviceQuantizePass(registry: RenderPassLibrary): void {
	registry.register({
		id: 'device_quantize',
		name: 'HeadlessDeviceQuantize',
		initialState: createDeviceQuantizeState(),
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			writeState: writeDeviceQuantizeState,
		},
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		exec: (backend, fbo, state: RenderPassStateRegistry['device_quantize']) => {
			const headless = backend as HeadlessGPUBackend;
			headless.activateRenderTarget(fbo as HeadlessRenderTargetHandle);
			applyHeadlessDeviceQuantize(headless.getTexturePixels(state.colorTex), headless.framebufferPixels, state.width, state.height, state.luts);
		},
	});
}
