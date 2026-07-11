import type { ColorAttachmentSpec, RenderPassDesc, RenderPassStateRegistry, TextureHandle } from '../../../backend/backend';
import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../../backend/webgpu/backend';
import vertexShaderCode from '../../webgpu/shaders/fullscreen.vert.wgsl';
import { DeviceQuantizeMode } from '../mode';
import { createDeviceQuantizeState, writeDeviceQuantizeState } from '../state';
import fragmentShaderCode from './shaders/device_quantize.frag.wgsl';

const DEVICE_QUANTIZE_UNIFORM_FLOATS = 4;
const deviceQuantizeUniformScratch = new Float32Array(DEVICE_QUANTIZE_UNIFORM_FLOATS);

type TextureBindCache = {
	texture: GPUTexture | null;
	view: GPUTextureView | null;
	bindGroup: GPUBindGroup | null;
};

function writeDeviceQuantizeUniforms(state: RenderPassStateRegistry['device_quantize']): void {
	deviceQuantizeUniformScratch[0] = state.baseWidth;
	deviceQuantizeUniformScratch[1] = state.baseHeight;
	deviceQuantizeUniformScratch[2] = state.width / state.baseWidth;
	deviceQuantizeUniformScratch[3] = state.deviceQuantizeMode;
}

function deviceQuantizeBindGroupForTexture(
	device: GPUDevice,
	layout: GPUBindGroupLayout,
	uniformBuffer: GPUBuffer,
	sampler: GPUSampler,
	cache: TextureBindCache,
	texture: GPUTexture,
): GPUBindGroup {
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

export function registerDeviceQuantize(registry: RenderPassLibrary): void {
	let pipeline: GPURenderPipeline;
	let layout: GPUBindGroupLayout;
	let sampler: GPUSampler;
	let uniformBuffer: GPUBuffer;
	let targetTexture: GPUTexture;
	const bindCache: TextureBindCache = { texture: null, view: null, bindGroup: null };
	const colorAttachment: ColorAttachmentSpec = { tex: null as TextureHandle };
	const passDesc: RenderPassDesc = { label: 'DeviceQuantize (WebGPU)', color: colorAttachment };

	registry.register({
		id: 'device_quantize',
		name: 'DeviceQuantize (WebGPU)',
		stateOnly: true,
		initialState: createDeviceQuantizeState(),
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			writeState: (ctx, state: RenderPassStateRegistry['device_quantize']) => {
				writeDeviceQuantizeState(ctx, state);
				targetTexture = ctx.getTex('device_color') as GPUTexture;
			},
		},
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		bootstrap: (backend) => {
			const wgpu = backend as WebGPUBackend;
			const device = wgpu.device;
			layout = device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
					{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
					{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
				],
			});
			const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
			pipeline = device.createRenderPipeline({
				label: 'webgpu_device_quantize',
				layout: pipelineLayout,
				vertex: { module: device.createShaderModule({ code: vertexShaderCode, label: 'webgpu_device_quantize_vs' }), entryPoint: 'main' },
				fragment: {
					module: device.createShaderModule({ code: fragmentShaderCode, label: 'webgpu_device_quantize_fs' }),
					entryPoint: 'main',
					targets: [{ format: 'bgra8unorm' }],
				},
				primitive: { topology: 'triangle-list' },
			});
			sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
			uniformBuffer = device.createBuffer({ size: DEVICE_QUANTIZE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		},
		exec: (backend, _fbo, state: RenderPassStateRegistry['device_quantize']) => {
			const wgpu = backend as WebGPUBackend;
			writeDeviceQuantizeUniforms(state);
			wgpu.device.queue.writeBuffer(uniformBuffer, 0, deviceQuantizeUniformScratch);
			const bindGroup = deviceQuantizeBindGroupForTexture(wgpu.device, layout, uniformBuffer, sampler, bindCache, state.colorTex as GPUTexture);
			colorAttachment.tex = targetTexture;
			const pass = wgpu.beginRenderPass(passDesc) as WebGPUPassEncoder;
			pass.encoder.setPipeline(pipeline);
			pass.encoder.setBindGroup(0, bindGroup);
			pass.encoder.draw(3);
			wgpu.endRenderPass(pass);
		},
	});
}
