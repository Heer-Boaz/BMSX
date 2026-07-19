import type { ColorAttachmentSpec, RenderGraphPassContext, RenderPassDesc, RenderPassStateRegistry, TextureHandle } from '../../../backend/backend';
import type { RenderPassLibrary } from '../../../backend/pass/library';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../../backend/webgpu/backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../../../backend/texture_params';
import vertexShaderCode from '../../webgpu/shaders/fullscreen.vert.wgsl';
import { DeviceQuantizeMode } from '../mode';
import { DEVICE_QUANTIZE_LUT_HEIGHT, DEVICE_QUANTIZE_LUTS, DEVICE_QUANTIZE_LUT_WIDTH } from '../lut';
import { createDeviceQuantizeState, writeDeviceQuantizeState } from '../state';
import fragmentShaderCode from './shaders/device_quantize.frag.wgsl';

export function registerDeviceQuantize(registry: RenderPassLibrary): void {
	let device: GPUDevice;
	let pipeline: GPURenderPipeline;
	let layout: GPUBindGroupLayout;
	let sampler: GPUSampler;
	let lutTextures: [GPUTexture, GPUTexture];
	let lutViews: [GPUTextureView, GPUTextureView];
	let targetTexture: GPUTexture;
	let bindGroup: GPUBindGroup;
	const colorAttachment: ColorAttachmentSpec = { tex: null as TextureHandle };
	const passDesc: RenderPassDesc = { label: 'DeviceQuantize (WebGPU)', color: colorAttachment };
	function publishDeviceQuantizeWebGpuState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['device_quantize']): void {
		targetTexture = ctx.getTex('device_color') as GPUTexture;
		const lutView = state.luts === DEVICE_QUANTIZE_LUTS[0] ? lutViews[0] : lutViews[1];
		bindGroup = device.createBindGroup({
			layout,
			entries: [
				{ binding: 0, resource: (state.colorTex as GPUTexture).createView() },
				{ binding: 1, resource: lutView },
				{ binding: 2, resource: sampler },
			],
		});
	}

	registry.register({
		id: 'device_quantize',
		name: 'DeviceQuantize (WebGPU)',
		stateOnly: true,
		initialState: createDeviceQuantizeState(),
		graph: {
			reads: ['frame_color'],
			writes: ['device_color'],
			writeState: function writeDeviceQuantizeWebGpuState(ctx, state: RenderPassStateRegistry['device_quantize']) {
				if (writeDeviceQuantizeState(ctx, state)) {
					publishDeviceQuantizeWebGpuState(ctx, state);
				}
			},
		},
		shouldExecute: (view) => view.deviceQuantizeMode !== DeviceQuantizeMode.None,
		bootstrap: (backend) => {
			const wgpu = backend as WebGPUBackend;
			device = wgpu.device;
			layout = device.createBindGroupLayout({
				entries: [
					{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
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
			sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
			lutTextures = [
				wgpu.createTexture(DEVICE_QUANTIZE_LUTS[0].texture, DEVICE_QUANTIZE_LUT_WIDTH, DEVICE_QUANTIZE_LUT_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS) as GPUTexture,
				wgpu.createTexture(DEVICE_QUANTIZE_LUTS[1].texture, DEVICE_QUANTIZE_LUT_WIDTH, DEVICE_QUANTIZE_LUT_HEIGHT, RGBA8_LINEAR_TEXTURE_PARAMS) as GPUTexture,
			];
			lutViews = [lutTextures[0].createView(), lutTextures[1].createView()];
		},
		teardown: (backend) => {
			backend.destroyTexture(lutTextures[0]);
			backend.destroyTexture(lutTextures[1]);
		},
		exec: function executeDeviceQuantizeWebGpu(backend) {
			const wgpu = backend as WebGPUBackend;
			colorAttachment.tex = targetTexture;
			const pass = wgpu.beginRenderPass(passDesc) as WebGPUPassEncoder;
			pass.encoder.setPipeline(pipeline);
			pass.encoder.setBindGroup(0, bindGroup);
			pass.encoder.draw(3);
			wgpu.endRenderPass(pass);
		},
	});
}
