/// <reference types="@webgpu/types" />
import { color_arr, type TextureSource } from '../../../rompack/format';
import { BackendCaps, ColorAttachmentSpec, GPUBackend, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, TextureFormat, TextureHandle } from '../backend';
import type { TextureParams } from '../texture_params';
import { createSolidRgba8Pixels, writeSolidRgba8Pixels } from '../../shared/solid_pixels';
import type { GxGpu } from '../../../machine/devices/gx/gpu';
import { registerCRT } from '../../post/crt/webgpu/pipeline';
import { registerDeviceQuantize } from '../../post/device_quantize/webgpu/pipeline';
import { captureRenderedVramSnapshot, registerGxGpuPass } from './gx_gpu';
import { updateAndBindFrameUniforms } from '../frame_uniforms';
import type { RenderPassLibrary } from '../pass/library';
import { registerHostOverlayPassesWebGPU } from '../../host_overlay/webgpu/pipeline';

const WEBGPU_ZERO_CLEAR: GPUColor = [0, 0, 0, 0];

export type WebGPUPassEncoder = PassEncoder & { encoder: GPURenderPassEncoder };

export class WebGPUBackend implements GPUBackend {
	static readonly supportsCorePresentation = true;

	get type(): 'webgpu' {
		return 'webgpu';
	}

	private stateRegistry: Map<RenderPassStateId, any> = new Map();
	private limits: GPUSupportedLimits;
	private pipelineIdCounter: number = 0;
	private pipelines: Map<number, GPURenderPipeline> = new Map();
	private pipelineBindingEntryCount: Map<number, number> = new Map();
	private pipelineExpected: Map<number, { binding: number; kind: 'buffer' | 'texture' | 'sampler' }[]> = new Map();
	// Cached resource/bind state
	private uniformBindings: Map<number, GPUBuffer> = new Map();
	private textureBindings: Map<number, GPUTextureView> = new Map();
	private samplerBindings: Map<number, GPUSampler> = new Map();
	private bindGroupCache: Map<number, GPUBindGroup> = new Map();
	private readonly textureViewCache = new WeakMap<GPUTexture, GPUTextureView>();
	private readonly renderPassColorAttachments: GPURenderPassColorAttachment[] = [];
	private readonly renderPassDepthStencilAttachment: GPURenderPassDepthStencilAttachment = {
		view: null,
		depthClearValue: 1.0,
		depthLoadOp: 'load',
		depthStoreOp: 'store',
		stencilClearValue: 0,
		stencilLoadOp: 'load',
		stencilStoreOp: 'store',
	};
	private readonly renderPassDesc: GPURenderPassDescriptor = { colorAttachments: this.renderPassColorAttachments };
	private readonly passEncoder: WebGPUPassEncoder = {
		fbo: null,
		desc: null as RenderPassDesc,
		encoder: null as GPURenderPassEncoder,
	};
	private readonly commandBufferSubmitList: GPUCommandBuffer[] = [];

	private _context: GPUCanvasContext = null;
	public get context(): GPUCanvasContext {
		return this._context;
	}

	private _bytesUploaded = 0;
	constructor(public device: GPUDevice, context: GPUCanvasContext, public readonly canvasFormat: GPUTextureFormat) {
		this.limits = this.device.limits;
		this._context = context;
	}

	registerBuiltinPasses(registry: RenderPassLibrary): void {
		registry.register({
			id: 'frame_resolve',
			name: 'FrameResolve',
			stateOnly: true,
			graph: { skip: true },
			exec: () => { },
			prepare: (backend) => {
				const gv = registry.view;
				updateAndBindFrameUniforms(backend, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y, gv.viewportSize.x, gv.viewportSize.y);
			},
		});
		registerGxGpuPass(registry);
		registerDeviceQuantize(registry);
		registerCRT(registry);
		registerHostOverlayPassesWebGPU(registry);
	}


	beginFrame(): void { this._bytesUploaded = 0; }
	endFrame(): void { }
	getFrameStats() { return { draws: 0, drawIndexed: 0, drawsInstanced: 0, drawIndexedInstanced: 0, bytesUploaded: this._bytesUploaded, vertexBytes: 0, indexBytes: 0, uniformBytes: this._bytesUploaded, textureBytes: 0 }; }
	captureGxGpuVramSnapshot(gxGpu: GxGpu): Promise<void> {
		const output = gxGpu.readDeviceOutput();
		return captureRenderedVramSnapshot(gxGpu, output);
	}
	accountUpload(_kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void {
		this._bytesUploaded += bytes;
	}

	createTexture(data: Uint8Array, width: number, height: number, _desc: TextureParams): TextureHandle {
		const format = _desc.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
		const texture = this.device.createTexture({
			size: { width, height, depthOrArrayLayers: 1 },
			format,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});

		this.device.queue.writeTexture(
			{ texture },
			data as Uint8Array<ArrayBuffer>,
			{ bytesPerRow: width * 4 },
			{ width, height, depthOrArrayLayers: 1 },
		);
		this.accountUpload('texture', width * height * 4);
		return texture;
	}

	updateTexture(handle: TextureHandle, data: Uint8Array, width: number, height: number, _desc: TextureParams): void {
		this.device.queue.writeTexture(
			{ texture: handle as GPUTexture },
			data as Uint8Array<ArrayBuffer>,
			{ bytesPerRow: width * 4 },
			{ width, height, depthOrArrayLayers: 1 },
		);
		this.accountUpload('texture', width * height * 4);
	}

	resizeTexture(_handle: TextureHandle, width: number, height: number, _desc: TextureParams): TextureHandle {
		const format = _desc.srgb ? 'rgba8unorm-srgb' : 'rgba8unorm';
		return this.device.createTexture({
			size: { width, height, depthOrArrayLayers: 1 },
			format,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});
	}

	updateTextureRegion(handle: TextureHandle, data: Uint8Array, width: number, height: number, x: number, y: number, _desc: TextureParams, sourceOffset = 0): void {
		this.device.queue.writeTexture(
			{ texture: handle as GPUTexture, origin: { x, y, z: 0 } },
			data as Uint8Array<ArrayBuffer>,
			{ offset: sourceOffset, bytesPerRow: width * 4 },
			{ width, height, depthOrArrayLayers: 1 },
		);
		this.accountUpload('texture', width * height * 4);
	}

	createSolidTexture2D(width: number, height: number, color: number, _desc: TextureParams): TextureHandle {
		const texture = this.device.createTexture({
			size: { width, height, depthOrArrayLayers: 1 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});
		const data = createSolidRgba8Pixels(width, height, color);
		this.device.queue.writeTexture(
			{ texture },
			data,
			{ bytesPerRow: width * 4 },
			{ width, height, depthOrArrayLayers: 1 },
		);
		return texture;
	}


	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], _desc: TextureParams): TextureHandle {
		const size = faces[0].width;
		const texture = this.device.createTexture({
			size: { width: size, height: size, depthOrArrayLayers: 6 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});

		faces.forEach((src, faceIndex) => {
			const data = src.data;
			if (data) {
				const upload = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
				this.device.queue.writeTexture(
					{ texture, origin: { x: 0, y: 0, z: faceIndex } },
					upload,
					{ bytesPerRow: src.width * 4 },
					{ width: src.width, height: src.height, depthOrArrayLayers: 1 },
				);
			} else {
				this.device.queue.copyExternalImageToTexture(
					{ source: src as ImageBitmap, flipY: false },
					{ texture, origin: { x: 0, y: 0, z: faceIndex } },
					{ width: size, height: size }
				);
			}
		});

		return texture;
	}

	createSolidCubemap(size: number, color: number, _desc: TextureParams): TextureHandle {
		const texture = this.device.createTexture({
			size: { width: size, height: size, depthOrArrayLayers: 6 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});

		const pixelCountPerFace = size * size;
		const data = new Uint8Array(pixelCountPerFace * 4 * 6);
		writeSolidRgba8Pixels(data, data.byteLength, color);

		const buffer = this.device.createBuffer({
			size: data.byteLength,
			usage: GPUBufferUsage.COPY_SRC,
			mappedAtCreation: true,
		});
		new Uint8Array(buffer.getMappedRange()).set(data);
		buffer.unmap();

		const commandEncoder = this.device.createCommandEncoder();
		for (let layer = 0; layer < 6; layer++) {
			commandEncoder.copyBufferToTexture(
				{ buffer, offset: layer * pixelCountPerFace * 4, bytesPerRow: size * 4 },
				{ texture, origin: { x: 0, y: 0, z: layer } },
				{ width: size, height: size, depthOrArrayLayers: 1 }
			);
		}
		this.commandBufferSubmitList[0] = commandEncoder.finish();
		this.device.queue.submit(this.commandBufferSubmitList);

		buffer.destroy();
		return texture;
	}

	createCubemapEmpty(size: number, _desc: TextureParams): TextureHandle {
		return this.device.createTexture({
			size: { width: size, height: size, depthOrArrayLayers: 6 },
			format: 'rgba8unorm',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
			mipLevelCount: 1,
			dimension: '2d',
		});
	}

	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void {
		const data = src.data;
		if (data) {
			const upload = new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
			this.device.queue.writeTexture(
				{ texture: cubemap as GPUTexture, origin: { x: 0, y: 0, z: face } },
				upload,
				{ bytesPerRow: src.width * 4 },
				{ width: src.width, height: src.height, depthOrArrayLayers: 1 },
			);
			return;
		}
		const img = src as ImageBitmap;
		this.device.queue.copyExternalImageToTexture(
			{ source: img },
			{ texture: cubemap as GPUTexture, origin: { x: 0, y: 0, z: face } },
			{ width: img.width, height: img.height }
		);
	}

	destroyTexture(handle: TextureHandle): void {
		this.textureBindings.clear();
		this.bindGroupCache.clear();
		const texture = handle as GPUTexture;
		this.textureViewCache.delete(texture);
		texture.destroy();
	}

	createColorTexture(desc: { width: number; height: number; format?: TextureFormat; initialClearColor?: color_arr }): TextureHandle {
		let format: GPUTextureFormat;
		switch (desc.format) {
			case undefined:
				format = 'bgra8unorm';
				break;
			case 6408:
			case 32856:
			case 'rgba8unorm':
				format = 'rgba8unorm';
				break;
			case 'bgra8unorm':
				format = 'bgra8unorm';
				break;
			default:
				format = desc.format as GPUTextureFormat;
				break;
		}
		const texture = this.device.createTexture({
			size: { width: desc.width, height: desc.height },
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
		});
		if (desc.initialClearColor !== undefined) {
			const commandEncoder = this.device.createCommandEncoder();
			const passEncoder = commandEncoder.beginRenderPass({
				colorAttachments: [{
					view: texture.createView(),
					clearValue: desc.initialClearColor,
					loadOp: 'clear',
					storeOp: 'store',
				}],
			});
			passEncoder.end();
			this.commandBufferSubmitList[0] = commandEncoder.finish();
			this.device.queue.submit(this.commandBufferSubmitList);
		}
		return texture;
	}

	createDepthTexture(desc: { width: number; height: number }): TextureHandle {
		return this.device.createTexture({
			size: { width: desc.width, height: desc.height },
			format: 'depth24plus-stencil8', // Or 'depth32float' if no stencil needed
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
	}

	createRenderTarget(color?: TextureHandle, depth?: TextureHandle): unknown {
		return { color, depth };
	}

	destroyRenderTarget(_handle: unknown): void {
	}

	private writeRenderPassColorAttachment(colorAttachmentIndex: number, color: ColorAttachmentSpec): void {
		const colorAttachments = this.renderPassColorAttachments;
		let attachment = colorAttachments[colorAttachmentIndex];
		if (attachment === undefined) {
			attachment = { view: null, clearValue: WEBGPU_ZERO_CLEAR, loadOp: 'load', storeOp: 'store' };
			colorAttachments[colorAttachmentIndex] = attachment;
		}
		const clear = color.clear;
		attachment.view = this.textureView(color.tex as GPUTexture);
		attachment.clearValue = clear !== undefined ? clear : WEBGPU_ZERO_CLEAR;
		attachment.loadOp = clear !== undefined ? 'clear' : 'load';
		attachment.storeOp = color.discardAfter ? 'discard' : 'store';
	}

	private textureView(texture: GPUTexture): GPUTextureView {
		let view = this.textureViewCache.get(texture);
		if (view === undefined) {
			view = texture.createView();
			this.textureViewCache.set(texture, view);
		}
		return view;
	}

	clear(color: color_arr | undefined, _depth: number | undefined): void {
		const commandEncoder = this.device.createCommandEncoder();
		let colorAttachments: GPURenderPassColorAttachment[] = [];

		if (this.context && color) {
			const view = this.context.getCurrentTexture().createView();
			colorAttachments = [{
				view,
				clearValue: color,
				loadOp: 'clear',
				storeOp: 'store',
			}];
		}

		const passDesc: GPURenderPassDescriptor = {
			colorAttachments,
		};

		const passEncoder = commandEncoder.beginRenderPass(passDesc);
		passEncoder.end();
		this.commandBufferSubmitList[0] = commandEncoder.finish();
		this.device.queue.submit(this.commandBufferSubmitList);
	}

	beginRenderPass(desc: RenderPassDesc): PassEncoder {
		const commandEncoder = this.device.createCommandEncoder();
		let colorAttachmentCount = 0;
		if (desc.colors !== undefined) {
			for (let colorIndex = 0; colorIndex < desc.colors.length; colorIndex++) {
				this.writeRenderPassColorAttachment(colorIndex, desc.colors[colorIndex]);
			}
			colorAttachmentCount = desc.colors.length;
		} else if (desc.color !== undefined) {
			this.writeRenderPassColorAttachment(0, desc.color);
			colorAttachmentCount = 1;
		}
		const colorAttachments = this.renderPassColorAttachments;
		colorAttachments.length = colorAttachmentCount;

		const passDesc = this.renderPassDesc;
		passDesc.colorAttachments = colorAttachments;
		if (desc.depth !== undefined) {
			const depth = desc.depth;
			const depthStencilAttachment = this.renderPassDepthStencilAttachment;
			const depthClear = depth.clearDepth;
			depthStencilAttachment.view = this.textureView(depth.tex as GPUTexture);
			depthStencilAttachment.depthClearValue = depthClear !== undefined ? depthClear : 1.0;
			depthStencilAttachment.depthLoadOp = depthClear !== undefined ? 'clear' : 'load';
			depthStencilAttachment.depthStoreOp = depth.discardAfter ? 'discard' : 'store';
			passDesc.depthStencilAttachment = depthStencilAttachment;
		} else {
			passDesc.depthStencilAttachment = undefined;
		}
		passDesc.label = desc.label;

		const passEncoder = this.passEncoder;
		passEncoder.fbo = commandEncoder;
		passEncoder.desc = desc;
		passEncoder.encoder = commandEncoder.beginRenderPass(passDesc);
		return passEncoder;
	}

	endRenderPass(pass: WebGPUPassEncoder): void {
		pass.encoder.end();
		this.commandBufferSubmitList[0] = (pass.fbo as GPUCommandEncoder).finish();
		this.device.queue.submit(this.commandBufferSubmitList);
	}

	getCaps(): BackendCaps {
		return {
			maxColorAttachments: this.limits.maxColorAttachments,
			maxTextureSize: this.limits.maxTextureDimension2D,
			supportsInstancing: true,
			supportsDepthTexture: true,
			supportsCorePresentation: true,
		};
	}

	createRenderPassInstance(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle {
		const bindGroupLayouts: GPUBindGroupLayout[] = [];
		let expectedEntries = 0;
		const expected: { binding: number; kind: 'buffer' | 'texture' | 'sampler' }[] = [];
		const layout = desc.bindingLayout;
		if (layout) {
			const entries: GPUBindGroupLayoutEntry[] = [];
			let binding = 0;

			const uniformDefs = Array.isArray(layout.uniforms) ? layout.uniforms : [];
			uniformDefs.forEach(() => {
				entries.push({ binding: binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } });
				expected.push({ binding, kind: 'buffer' });
				binding++;
				expectedEntries++;
			});
			const textureDefs = Array.isArray(layout.textures) ? layout.textures : [];
			textureDefs.forEach(_t => {
				entries.push({ binding: binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } });
				expected.push({ binding, kind: 'texture' });
				binding++;
				expectedEntries++;
			});
			const samplerDefs = Array.isArray(layout.samplers) ? layout.samplers : [];
			samplerDefs.forEach(_s => {
				entries.push({ binding: binding, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } });
				expected.push({ binding, kind: 'sampler' });
				binding++;
				expectedEntries++;
			});
			const bufferDefs = Array.isArray(layout.buffers) ? layout.buffers : [];
			bufferDefs.forEach(b => {
				entries.push({ binding: binding, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: b.usage === 'storage' ? 'storage' : 'uniform' } });
				expected.push({ binding, kind: 'buffer' });
				binding++;
				expectedEntries++;
			});

			bindGroupLayouts.push(this.device.createBindGroupLayout({ entries }));
		}

		const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts });

		const pipeline = this.device.createRenderPipeline({
			label: desc.label,
			layout: pipelineLayout,
			vertex: {
				module: this.device.createShaderModule({ code: desc.vsCode! }),
				entryPoint: 'main',
			},
			fragment: {
				module: this.device.createShaderModule({ code: desc.fsCode! }),
				entryPoint: 'main',
				targets: [{ format: 'bgra8unorm' }],
			},
			primitive: { topology: 'triangle-list' },
			depthStencil: (desc.usesDepth || desc.depthTest) ? {
				format: 'depth24plus-stencil8',
				depthWriteEnabled: !!desc.depthWrite,
				depthCompare: 'less',
				stencilReadMask: 0xff,
				stencilWriteMask: 0xff,
			} : undefined,
		});

		const id = this.pipelineIdCounter++;
		this.pipelines.set(id, pipeline);
		this.pipelineBindingEntryCount.set(id, expectedEntries);
		if (expectedEntries > 0) this.pipelineExpected.set(id, expected);
		return { id, label: desc.label };
	}

	destroyRenderPassInstance(p: RenderPassInstanceHandle): void {
		this.pipelines.delete(p.id);
		this.pipelineBindingEntryCount.delete(p.id);
		this.pipelineExpected.delete(p.id);
	}

	setGraphicsPipeline(pass: PassEncoder, pipelineHandle: RenderPassInstanceHandle): void {
		const pipeline = this.pipelines.get(pipelineHandle.id)!;
		const enc = (pass as WebGPUPassEncoder).encoder;
		enc.setPipeline(pipeline);
		const expectedCount = this.pipelineBindingEntryCount.get(pipelineHandle.id)!;
		if (expectedCount === 0) return;
		const expectList = this.pipelineExpected.get(pipelineHandle.id)!;
		let bg = this.bindGroupCache.get(pipelineHandle.id);
		const layout = (pipeline as GPURenderPipeline).getBindGroupLayout(0);
		if (!bg) {
			const entries: GPUBindGroupEntry[] = [];
			for (const exp of expectList) {
				switch (exp.kind) {
					case 'buffer': {
						const buf = this.uniformBindings.get(exp.binding)!;
						entries.push({ binding: exp.binding, resource: { buffer: buf } });
						break;
					}
					case 'texture': {
						const view = this.textureBindings.get(exp.binding)!;
						entries.push({ binding: exp.binding, resource: view });
						break;
					}
					case 'sampler': {
						const samp = this.samplerBindings.get(exp.binding)!;
						entries.push({ binding: exp.binding, resource: samp });
						break;
					}
				}
			}
			bg = this.device.createBindGroup({ layout, entries });
			this.bindGroupCache.set(pipelineHandle.id, bg);
		}
		enc.setBindGroup(0, bg);
	}

	draw(pass: PassEncoder, first: number, count: number): void {
		const encoder = (pass as WebGPUPassEncoder).encoder;
		encoder.draw(count, 1, first, 0);
	}

	drawIndexed(pass: PassEncoder, indexCount: number, firstIndex: number, _indexType?: number): void {
		const encoder = (pass as WebGPUPassEncoder).encoder;
		encoder.drawIndexed(indexCount, 1, firstIndex, 0, 0);
	}

	drawInstanced(pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex = 0, firstInstance = 0): void {
		const encoder = (pass as WebGPUPassEncoder).encoder;
		encoder.draw(vertexCount, instanceCount, firstVertex, firstInstance);
	}

	drawIndexedInstanced(pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex = 0, baseVertex = 0, firstInstance = 0, _indexType?: number): void {
		const encoder = (pass as WebGPUPassEncoder).encoder;
		encoder.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance);
	}

	setPassState<S = unknown>(label: RenderPassStateId, state: S): void {
		this.stateRegistry.set(label, state);
	}

	getPassState<S = unknown>(label: RenderPassStateId): S {
		return this.stateRegistry.get(label) as S;
	}

	createUniformBuffer(byteSize: number, usage: 'static' | 'dynamic'): GPUBuffer {
		void usage; // reserved for future usage hint mapping
		return this.device.createBuffer({ size: byteSize, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, mappedAtCreation: false });
	}
	updateUniformBuffer(buf: GPUBuffer, data: ArrayBufferView, dstByteOffset = 0): void {
		this.device.queue.writeBuffer(buf, dstByteOffset, data.buffer, data.byteOffset, data.byteLength);
		this._bytesUploaded += data.byteLength;
	}
	bindUniformBufferBase(bindingIndex: number, buf: GPUBuffer): void {
		if (this.uniformBindings.get(bindingIndex) === buf) return;
		this.uniformBindings.set(bindingIndex, buf);
		// Invalidate cached bind groups to reflect new resources
		this.bindGroupCache.clear();
	}

	bindTextureView(bindingIndex: number, view: GPUTextureView): void {
		if (this.textureBindings.get(bindingIndex) === view) return;
		this.textureBindings.set(bindingIndex, view);
		this.bindGroupCache.clear();
	}

	bindSampler(bindingIndex: number, sampler: GPUSampler): void {
		if (this.samplerBindings.get(bindingIndex) === sampler) return;
		this.samplerBindings.set(bindingIndex, sampler);
		this.bindGroupCache.clear();
	}

}
