import type { ColorAttachmentSpec, GPUBackend, RenderGraphPassContext, RenderPassDesc, RenderPassStateRegistry, TextureHandle } from '../../../backend/backend';
import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../../backend/webgpu/backend';
import type { GameView } from '../../../gameview';
import { createCrtPassState, createPresentPassState, shouldExecuteAutoCrtPass, shouldExecuteAutoPresentPass, shouldUpdatePresentationHistoryA, shouldUpdatePresentationHistoryB, writeCrtPassState, writePresentPassState } from '../state';
import fragmentShaderCRTCode from './shaders/crt.frag.wgsl';
import fragmentShaderPresentCode from './shaders/present.frag.wgsl';
import vertexShaderCRTCode from './shaders/crt.vert.wgsl';

const CRT_UNIFORM_FLOATS = 24;
const crtUniformScratch = new Float32Array(CRT_UNIFORM_FLOATS);

type TextureBindCache = {
	texture: GPUTexture | null;
	view: GPUTextureView | null;
	bindGroup: GPUBindGroup | null;
};

function writeCrtUniforms(out: Float32Array, state: RenderPassStateRegistry['crt']): void {
	out[0] = state.baseWidth;
	out[1] = state.baseHeight;
	out[2] = state.srcWidth / state.baseWidth;
	out[3] = state.time;
	out[4] = Math.random();
	const opts = state.options;
	out[5] = opts.applyNoise ? 1 : 0;
	out[6] = opts.applyColorBleed ? 1 : 0;
	out[7] = opts.applyScanlines ? 1 : 0;
	out[8] = opts.applyBlur ? 1 : 0;
	out[9] = opts.applyGlow ? 1 : 0;
	out[10] = opts.applyFringing ? 1 : 0;
	out[11] = opts.applyAperture ? 1 : 0;
	out[12] = opts.noiseIntensity;
	out[13] = opts.blurIntensity;
	out[16] = opts.colorBleed[0];
	out[17] = opts.colorBleed[1];
	out[18] = opts.colorBleed[2];
	out[20] = opts.glowColor[0];
	out[21] = opts.glowColor[1];
	out[22] = opts.glowColor[2];
}

function createPresentPipeline(device: GPUDevice, layout: GPUBindGroupLayout, targetFormat: GPUTextureFormat): GPURenderPipeline {
	const vertex = device.createShaderModule({ code: vertexShaderCRTCode, label: 'webgpu_present_vs' });
	const fragment = device.createShaderModule({ code: fragmentShaderPresentCode, label: 'webgpu_present_fs' });
	return device.createRenderPipeline({
		label: 'webgpu_present',
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		vertex: { module: vertex, entryPoint: 'main' },
		fragment: { module: fragment, entryPoint: 'main', targets: [{ format: targetFormat }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createCrtPipeline(device: GPUDevice, layout: GPUBindGroupLayout, targetFormat: GPUTextureFormat): GPURenderPipeline {
	const vertex = device.createShaderModule({ code: vertexShaderCRTCode, label: 'webgpu_crt_vs' });
	const fragment = device.createShaderModule({ code: fragmentShaderCRTCode, label: 'webgpu_crt_fs' });
	return device.createRenderPipeline({
		label: 'webgpu_crt',
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		vertex: { module: vertex, entryPoint: 'main' },
		fragment: { module: fragment, entryPoint: 'main', targets: [{ format: targetFormat }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createPresentBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		],
	});
}

function createCrtBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		],
	});
}

function presentBindGroupForTexture(device: GPUDevice, layout: GPUBindGroupLayout, sampler: GPUSampler, cache: TextureBindCache, texture: GPUTexture): GPUBindGroup {
	if (cache.texture !== texture) {
		cache.texture = texture;
		cache.view = texture.createView();
		cache.bindGroup = device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: cache.view },
				{ binding: 1, resource: sampler },
			],
		});
	}
	return cache.bindGroup as GPUBindGroup;
}

function crtBindGroupForTexture(device: GPUDevice, layout: GPUBindGroupLayout, uniformBuffer: GPUBuffer, sampler: GPUSampler, cache: TextureBindCache, texture: GPUTexture): GPUBindGroup {
	if (cache.texture !== texture) {
		cache.texture = texture;
		cache.view = texture.createView();
		cache.bindGroup = device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: cache.view },
				{ binding: 2, resource: sampler },
			],
		});
	}
	return cache.bindGroup as GPUBindGroup;
}

function renderFullscreen(backend: GPUBackend, pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, target: GPUTexture): void {
	const wgpu = backend as WebGPUBackend;
	const passDesc: RenderPassDesc = { label: 'WebGPUFullscreen', color: { tex: target } as ColorAttachmentSpec };
	const pass = wgpu.beginRenderPass(passDesc) as WebGPUPassEncoder;
	const encoder = pass.encoder;
	encoder.setPipeline(pipeline);
	encoder.setBindGroup(0, bindGroup);
	encoder.draw(3);
	wgpu.endRenderPass(pass);
}

function currentFrameSourceTexture(ctx: RenderGraphPassContext, view: GameView): TextureHandle {
	return ctx.deviceColorEnabled && view.dither_type !== 0 ? ctx.getTex('device_color') : ctx.getTex('frame_color');
}

export function registerCRT(registry: RenderPassLibrary): void {
	let presentLayout: GPUBindGroupLayout;
	let crtLayout: GPUBindGroupLayout;
	let presentHistoryPipeline: GPURenderPipeline;
	let presentCanvasPipeline: GPURenderPipeline;
	let crtPipeline: GPURenderPipeline;
	let sampler: GPUSampler;
	let uniformBuffer: GPUBuffer;
	const historyACache: TextureBindCache = { texture: null, view: null, bindGroup: null };
	const historyBCache: TextureBindCache = { texture: null, view: null, bindGroup: null };
	const presentCache: TextureBindCache = { texture: null, view: null, bindGroup: null };
	const crtCache: TextureBindCache = { texture: null, view: null, bindGroup: null };

	const bootstrap = (backend: GPUBackend) => {
		const wgpu = backend as WebGPUBackend;
		presentLayout = createPresentBindGroupLayout(wgpu.device);
		crtLayout = createCrtBindGroupLayout(wgpu.device);
		presentHistoryPipeline = createPresentPipeline(wgpu.device, presentLayout, 'bgra8unorm');
		presentCanvasPipeline = createPresentPipeline(wgpu.device, presentLayout, wgpu.canvasFormat);
		crtPipeline = createCrtPipeline(wgpu.device, crtLayout, wgpu.canvasFormat);
		sampler = wgpu.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		uniformBuffer = wgpu.device.createBuffer({ size: CRT_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	};

	function writeHistoryState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['presentation_history_a'] | RenderPassStateRegistry['presentation_history_b'], targetSlot: 'frame_history_a' | 'frame_history_b'): void {
		const view = ctx.view as GameView;
		state.width = view.offscreenCanvasSize.x;
		state.height = view.offscreenCanvasSize.y;
		state.srcWidth = view.offscreenCanvasSize.x;
		state.srcHeight = view.offscreenCanvasSize.y;
		state.colorTex = currentFrameSourceTexture(ctx, view);
		state.targetColorTex = ctx.getTex(targetSlot);
	}

	registry.register({
		id: 'presentation_history_a',
		name: 'PresentationHistoryA (WebGPU)',
		stateOnly: true,
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_a'], writeState: (ctx, state) => writeHistoryState(ctx, state as RenderPassStateRegistry['presentation_history_a'], 'frame_history_a') },
		shouldExecute: shouldUpdatePresentationHistoryA,
		bootstrap,
		exec: (backend, _fbo, state: RenderPassStateRegistry['presentation_history_a']) => {
			const wgpu = backend as WebGPUBackend;
			const bindGroup = presentBindGroupForTexture(wgpu.device, presentLayout, sampler, historyACache, state.colorTex as GPUTexture);
			renderFullscreen(backend, presentHistoryPipeline, bindGroup, state.targetColorTex as GPUTexture);
		},
	});

	registry.register({
		id: 'presentation_history_b',
		name: 'PresentationHistoryB (WebGPU)',
		stateOnly: true,
		initialState: createPresentPassState(),
		graph: { reads: ['frame_color', 'device_color'], writes: ['frame_history_b'], writeState: (ctx, state) => writeHistoryState(ctx, state as RenderPassStateRegistry['presentation_history_b'], 'frame_history_b') },
		shouldExecute: shouldUpdatePresentationHistoryB,
		exec: (backend, _fbo, state: RenderPassStateRegistry['presentation_history_b']) => {
			const wgpu = backend as WebGPUBackend;
			const bindGroup = presentBindGroupForTexture(wgpu.device, presentLayout, sampler, historyBCache, state.colorTex as GPUTexture);
			renderFullscreen(backend, presentHistoryPipeline, bindGroup, state.targetColorTex as GPUTexture);
		},
	});

	registry.register({
		id: 'present',
		name: 'Present (WebGPU)',
		present: true,
		initialState: createPresentPassState(),
		graph: { presentInput: 'auto', writeState: writePresentPassState },
		shouldExecute: shouldExecuteAutoPresentPass,
		exec: (backend, _fbo, state: RenderPassStateRegistry['present']) => {
			const wgpu = backend as WebGPUBackend;
			const bindGroup = presentBindGroupForTexture(wgpu.device, presentLayout, sampler, presentCache, state.colorTex as GPUTexture);
			renderFullscreen(backend, presentCanvasPipeline, bindGroup, wgpu.context.getCurrentTexture());
		},
	});

	registry.register({
		id: 'crt',
		name: 'Present/CRT (WebGPU)',
		present: true,
		initialState: createCrtPassState(),
		graph: { presentInput: 'auto', writeState: writeCrtPassState },
		shouldExecute: shouldExecuteAutoCrtPass,
		exec: (backend, _fbo, state: RenderPassStateRegistry['crt']) => {
			const wgpu = backend as WebGPUBackend;
			writeCrtUniforms(crtUniformScratch, state);
			wgpu.device.queue.writeBuffer(uniformBuffer, 0, crtUniformScratch);
			const bindGroup = crtBindGroupForTexture(wgpu.device, crtLayout, uniformBuffer, sampler, crtCache, state.colorTex as GPUTexture);
			renderFullscreen(backend, crtPipeline, bindGroup, wgpu.context.getCurrentTexture());
		},
	});
}
