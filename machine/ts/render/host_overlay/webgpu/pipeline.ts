import type {
	ColorAttachmentSpec,
	Host2DPipelineState,
	HostMenuPipelineState,
	HostOverlayPipelineState,
	RenderPassDesc,
	RenderPassStateRegistry,
	TextureHandle,
} from '../../backend/backend';
import type { RenderPassLibrary } from '../../backend/pass/library';
import type { WebGPUBackend, WebGPUPassEncoder } from '../../backend/webgpu/backend';
import { RGBA8_SRGB_TEXTURE_PARAMS } from '../../backend/texture_params';
import {
	HOST_OVERLAY_INSTANCE_FLOAT_BYTES,
	HOST_OVERLAY_INSTANCE_FLOATS,
	HostOverlayQuadStream,
} from '../quad_stream';
import { hasPendingHostMenuFrame, hasPendingOverlayFrame } from '../overlay_queue';
import { createHostMenuState, createHostOverlayState, writeHostMenuState, writeHostOverlayState } from '../pipeline';
import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasPixels,
} from '../../../rompack/host_system_atlas';
import vertexShaderCode from './shaders/host_overlay.vert.wgsl';
import fragmentShaderCode from './shaders/host_overlay.frag.wgsl';

type HostOverlayRuntime = {
	pipeline: GPURenderPipeline;
	bindGroup: GPUBindGroup;
	uniformBuffer: GPUBuffer;
	instanceFloatBuffer: GPUBuffer;
	instanceTextureKindBuffer: GPUBuffer;
	instanceCapacity: number;
	colorAttachment: ColorAttachmentSpec;
	passDesc: RenderPassDesc;
	stream: HostOverlayQuadStream;
};

const OVERLAY_UNIFORM_FLOATS = 4;
const overlayUniformScratch = new Float32Array(OVERLAY_UNIFORM_FLOATS);

function createInstanceFloatBuffer(device: GPUDevice, stream: HostOverlayQuadStream): GPUBuffer {
	return device.createBuffer({
		label: 'host_overlay_instances',
		size: stream.floatData.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
}

function createInstanceTextureKindBuffer(device: GPUDevice, stream: HostOverlayQuadStream): GPUBuffer {
	return device.createBuffer({
		label: 'host_overlay_texture_kinds',
		size: stream.textureKinds.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
}

function createRuntime(backend: WebGPUBackend): HostOverlayRuntime {
	const device = backend.device;
	const stream = new HostOverlayQuadStream();
	const bindGroupLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		],
	});
	const pipeline = device.createRenderPipeline({
		label: 'webgpu_host_overlay',
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: {
			module: device.createShaderModule({ code: vertexShaderCode, label: 'webgpu_host_overlay_vs' }),
			entryPoint: 'main',
			buffers: [
				{
					arrayStride: HOST_OVERLAY_INSTANCE_FLOAT_BYTES,
					stepMode: 'instance',
					attributes: [
						{ shaderLocation: 0, offset: 0, format: 'float32x2' },
						{ shaderLocation: 1, offset: 2 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
						{ shaderLocation: 2, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
						{ shaderLocation: 3, offset: 6 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
						{ shaderLocation: 4, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' },
						{ shaderLocation: 6, offset: 10 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
					],
				},
				{
					arrayStride: Uint32Array.BYTES_PER_ELEMENT,
					stepMode: 'instance',
					attributes: [{ shaderLocation: 5, offset: 0, format: 'uint32' }],
				},
			],
		},
		fragment: {
			module: device.createShaderModule({ code: fragmentShaderCode, label: 'webgpu_host_overlay_fs' }),
			entryPoint: 'main',
			targets: [{
				format: backend.canvasFormat,
				blend: {
					color: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
					alpha: { operation: 'add', srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
				},
			}],
		},
		primitive: { topology: 'triangle-list' },
	});
	const uniformBuffer = device.createBuffer({
		label: 'host_overlay_uniforms',
		size: OVERLAY_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const hostAtlasTexture = backend.createTexture(hostSystemAtlasPixels(), HOST_SYSTEM_ATLAS_WIDTH, HOST_SYSTEM_ATLAS_HEIGHT, RGBA8_SRGB_TEXTURE_PARAMS) as GPUTexture;
	const hostSampler = device.createSampler({
		magFilter: 'nearest',
		minFilter: 'nearest',
		addressModeU: 'clamp-to-edge',
		addressModeV: 'clamp-to-edge',
	});
	const bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: hostAtlasTexture.createView() },
			{ binding: 2, resource: hostSampler },
		],
	});
	const colorAttachment: ColorAttachmentSpec = { tex: null as TextureHandle };
	return {
		pipeline,
		bindGroup,
		uniformBuffer,
		instanceFloatBuffer: createInstanceFloatBuffer(device, stream),
		instanceTextureKindBuffer: createInstanceTextureKindBuffer(device, stream),
		instanceCapacity: stream.capacity,
		colorAttachment,
		passDesc: { label: 'HostOverlay (WebGPU)', color: colorAttachment },
		stream,
	};
}

function prepareInstanceBuffers(device: GPUDevice, runtime: HostOverlayRuntime): void {
	const stream = runtime.stream;
	if (runtime.instanceCapacity === stream.capacity) {
		return;
	}
	runtime.instanceFloatBuffer.destroy();
	runtime.instanceTextureKindBuffer.destroy();
	runtime.instanceFloatBuffer = createInstanceFloatBuffer(device, stream);
	runtime.instanceTextureKindBuffer = createInstanceTextureKindBuffer(device, stream);
	runtime.instanceCapacity = stream.capacity;
}

function renderStream(backend: WebGPUBackend, runtime: HostOverlayRuntime, state: Host2DPipelineState): void {
	const stream = runtime.stream;
	const count = stream.count;
	if (count === 0) {
		return;
	}
	const device = backend.device;
	prepareInstanceBuffers(device, runtime);
	overlayUniformScratch[0] = state.overlayWidth;
	overlayUniformScratch[1] = state.overlayHeight;
	device.queue.writeBuffer(runtime.uniformBuffer, 0, overlayUniformScratch);
	const floatBytes = count * HOST_OVERLAY_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
	device.queue.writeBuffer(runtime.instanceFloatBuffer, 0, stream.floatData.buffer, stream.floatData.byteOffset, floatBytes);
	const textureKindBytes = count * Uint32Array.BYTES_PER_ELEMENT;
	device.queue.writeBuffer(runtime.instanceTextureKindBuffer, 0, stream.textureKinds.buffer, stream.textureKinds.byteOffset, textureKindBytes);
	backend.accountUpload('uniform', overlayUniformScratch.byteLength);
	backend.accountUpload('vertex', floatBytes + textureKindBytes);
	runtime.colorAttachment.tex = backend.context.getCurrentTexture() as TextureHandle;
	const pass = backend.beginRenderPass(runtime.passDesc) as WebGPUPassEncoder;
	pass.encoder.setPipeline(runtime.pipeline);
	pass.encoder.setBindGroup(0, runtime.bindGroup);
	pass.encoder.setVertexBuffer(0, runtime.instanceFloatBuffer);
	pass.encoder.setVertexBuffer(1, runtime.instanceTextureKindBuffer);
	pass.encoder.draw(6, count);
	backend.endRenderPass(pass);
}

export function registerHostOverlayPassesWebGPU(registry: RenderPassLibrary): void {
	let runtime: HostOverlayRuntime;
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay (WebGPU)',
		present: true,
		initialState: createHostOverlayState(),
		graph: { writeState: writeHostOverlayState },
		bootstrap: (backend) => {
			runtime = createRuntime(backend as WebGPUBackend);
		},
		shouldExecute: () => hasPendingOverlayFrame(),
		exec: (backend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			const stream = runtime.stream;
			stream.reset();
			for (let index = 0; index < state.commands.length; index += 1) {
				stream.appendSubmission(state.commands[index]);
			}
			renderStream(backend as WebGPUBackend, runtime, state as HostOverlayPipelineState);
		},
	});
	registry.register({
		id: 'host_menu',
		name: 'HostMenu (WebGPU)',
		present: true,
		initialState: createHostMenuState(),
		graph: { writeState: writeHostMenuState },
		shouldExecute: () => hasPendingHostMenuFrame(),
		exec: (backend, _fbo, state: RenderPassStateRegistry['host_menu']) => {
			const stream = runtime.stream;
			stream.reset();
			for (let index = 0; index < state.commandCount; index += 1) {
				stream.appendEntry(state.commandKinds[index], state.commandRefs[index]);
			}
			renderStream(backend as WebGPUBackend, runtime, state as HostMenuPipelineState);
		},
	});
}
