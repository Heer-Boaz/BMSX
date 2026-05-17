/// <reference types="@webgpu/types" />
import { color_arr, type TextureSource } from '../../../rompack/format';
import { BackendCaps, ColorAttachmentSpec, GPUBackend, GraphicsPipelineBuildDesc, PassEncoder, RenderPassDesc, RenderPassInstanceHandle, RenderPassStateId, TextureFormat, TextureHandle, type VdpFrameBufferExecutionPassState } from '../backend';
import { DEFAULT_TEXTURE_PARAMS, type TextureParams } from '../texture_params';
import { createSolidRgba8Pixels, writeSolidRgba8Pixels } from '../../shared/solid_pixels';
import { consoleCore } from '../../../core/console';
import { registerSkyboxPass_WebGPU } from '../../3d/skybox/pipeline.wgpu';
import { registerParticlesPass_WebGPU } from '../../3d/particles/pipeline.wgpu';
import { registerCRT_WebGPU } from '../../post/crt/pipeline.wgpu';
import { updateAndBindFrameUniforms } from '../frame_uniforms';
import type { RenderPassLibrary } from '../pass/library';

const WEBGPU_ZERO_CLEAR: GPUColor = [0, 0, 0, 0];

export type WebGPUPassEncoder = PassEncoder & { encoder: GPURenderPassEncoder };

export class WebGPUBackend implements GPUBackend {
	get type(): 'webgl2' | 'webgpu' {
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
	private _activePassEncoder: GPURenderPassEncoder | undefined;

	private _context: GPUCanvasContext = null;
	public get context(): GPUCanvasContext {
		return this._context;
	}

	private _bytesUploaded = 0;
	constructor(public device: GPUDevice, context: GPUCanvasContext) {
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
				const gv = consoleCore.view;
				updateAndBindFrameUniforms(backend, gv.offscreenCanvasSize.x, gv.offscreenCanvasSize.y, gv.viewportSize.x, gv.viewportSize.y);
			},
		});
		registry.register({ id: 'frame_shared', name: 'FrameShared', stateOnly: true, graph: { skip: true }, exec: () => { } });
		registry.register<VdpFrameBufferExecutionPassState>({
			id: 'vdp_framebuffer_execution',
			name: 'VDPFrameBufferExecution',
			stateOnly: true,
			graph: { skip: true },
			exec: () => {
				throw new Error('[VDPFrameBufferWebGPU] VDP framebuffer execution is not implemented for WebGPU.');
			},
		});
		registry.register({ id: 'framebuffer_2d', name: 'Framebuffer2D', stateOnly: true, exec: () => { } });
		registerSkyboxPass_WebGPU(registry);
		registerParticlesPass_WebGPU(registry);
		registerCRT_WebGPU(registry);
	}


	beginFrame(): void { this._bytesUploaded = 0; }
	endFrame(): void { }
	getFrameStats() { return { draws: 0, drawIndexed: 0, drawsInstanced: 0, drawIndexedInstanced: 0, bytesUploaded: this._bytesUploaded, vertexBytes: 0, indexBytes: 0, uniformBytes: this._bytesUploaded, textureBytes: 0 }; }
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

	readTextureRegion(_handle: TextureHandle, _out: Uint8Array, _width: number, _height: number, _x: number, _y: number, _desc: TextureParams): void {
		throw new Error('[WebGPUBackend] Texture readback is not yet supported, but it will be implemented in the future.');
	}

	createSolidTexture2D(width: number, height: number, color: number, _desc: TextureParams = DEFAULT_TEXTURE_PARAMS): TextureHandle {
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
		if (faces.length !== 6 || !faces.every(f => f.width === faces[0].width && f.height === faces[0].height)) {
			throw new Error('All cubemap faces must be the same square size');
		}

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

		// Create a buffer with the color repeated for each pixel per face
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

		// Copy buffer to texture, layer by layer
		const commandEncoder = this.device.createCommandEncoder();
		for (let layer = 0; layer < 6; layer++) {
			commandEncoder.copyBufferToTexture(
				{ buffer, offset: layer * pixelCountPerFace * 4, bytesPerRow: size * 4 },
				{ texture, origin: { x: 0, y: 0, z: layer } },
				{ width: size, height: size, depthOrArrayLayers: 1 }
			);
		}
		this.device.queue.submit([commandEncoder.finish()]);

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
		if (face < 0 || face > 5) throw new Error('Invalid cubemap face index');
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
		(handle as GPUTexture).destroy();
	}

	createColorTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle {
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
				throw new Error(`[WebGPUBackend] Unsupported color texture format: ${String(desc.format)}.`);
		}
		const texture = this.device.createTexture({
			size: { width: desc.width, height: desc.height },
			format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
		});
		this.device.queue.writeTexture(
			{ texture },
			new Uint8Array(desc.width * desc.height * 4),
			{ bytesPerRow: desc.width * 4 },
			{ width: desc.width, height: desc.height, depthOrArrayLayers: 1 },
		);
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
		// In WebGPU, no explicit FBO; return a descriptor-like object for compatibility
		return { color, depth };
	}

	private writeRenderPassColorAttachment(colorAttachmentIndex: number, color: ColorAttachmentSpec): void {
		const colorAttachments = this.renderPassColorAttachments;
		let attachment = colorAttachments[colorAttachmentIndex];
		if (attachment === undefined) {
			attachment = { view: null, clearValue: WEBGPU_ZERO_CLEAR, loadOp: 'load', storeOp: 'store' };
			colorAttachments[colorAttachmentIndex] = attachment;
		}
		const clear = color.clear;
		attachment.view = (color.tex as GPUTexture).createView();
		attachment.clearValue = clear !== undefined ? clear : WEBGPU_ZERO_CLEAR;
		attachment.loadOp = clear !== undefined ? 'clear' : 'load';
		attachment.storeOp = color.discardAfter ? 'discard' : 'store';
	}

	clear(color: color_arr | undefined, _depth: number | undefined): void {
		// To clear outside a pass, create a temporary render pass for clearing
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
			// depthStencilAttachment if needed, but skipped if no tex
		};

		const passEncoder = commandEncoder.beginRenderPass(passDesc);
		passEncoder.end();
		this.device.queue.submit([commandEncoder.finish()]);
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
			depthStencilAttachment.view = (depth.tex as GPUTexture).createView();
			depthStencilAttachment.depthClearValue = depthClear !== undefined ? depthClear : 1.0;
			depthStencilAttachment.depthLoadOp = depthClear !== undefined ? 'clear' : 'load';
			depthStencilAttachment.depthStoreOp = depth.discardAfter ? 'discard' : 'store';
			passDesc.depthStencilAttachment = depthStencilAttachment;
		} else {
			passDesc.depthStencilAttachment = undefined;
		}
		passDesc.label = desc.label;

		const encoder = commandEncoder.beginRenderPass(passDesc);
		this._activePassEncoder = encoder;
		return { fbo: commandEncoder, desc, encoder } as WebGPUPassEncoder;
	}

	endRenderPass(pass: WebGPUPassEncoder): void {
		pass.encoder.end();
		this.device.queue.submit([(pass.fbo as GPUCommandEncoder).finish()]);
		if (this._activePassEncoder === pass.encoder) this._activePassEncoder = null;
	}

	getCaps(): BackendCaps {
		return {
			maxColorAttachments: this.limits.maxColorAttachments,
			maxTextureSize: this.limits.maxTextureDimension2D,
			supportsInstancing: true,
			supportsDepthTexture: true,
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

			if (desc.vsCode === undefined || desc.fsCode === undefined) {
				throw new Error(`[WebGPUBackend] Pipeline '${desc.label}' requires both vertex and fragment shader code.`);
			}
			const pipeline = this.device.createRenderPipeline({
				label: desc.label,
				layout: pipelineLayout,
				vertex: {
					module: this.device.createShaderModule({ code: desc.vsCode }),
					entryPoint: 'main',
					// Add buffers if needed
				},
				fragment: {
					module: this.device.createShaderModule({ code: desc.fsCode }),
					entryPoint: 'main',
					targets: [{ format: 'bgra8unorm' }],
			},
			primitive: { topology: 'triangle-list' }, // Customize as needed
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
		const pipeline = this.pipelines.get(pipelineHandle.id);
		if (!pipeline) return;
		const enc = (pass as WebGPUPassEncoder).encoder ?? this._activePassEncoder;
		if (!enc) return;
		enc.setPipeline(pipeline);
		// Bind group 0 using only entries expected by this pipeline
			const expectedCount = this.pipelineBindingEntryCount.get(pipelineHandle.id) ?? 0;
			if (expectedCount === 0) return;
			const expectList = this.pipelineExpected.get(pipelineHandle.id)!;
			let bg = this.bindGroupCache.get(pipelineHandle.id);
		const layout = (pipeline as GPURenderPipeline).getBindGroupLayout(0);
			if (!bg) {
				const entries: GPUBindGroupEntry[] = [];
				let missing = false;
				for (const exp of expectList) {
					switch (exp.kind) {
						case 'buffer': {
							const buf = this.uniformBindings.get(exp.binding);
							if (!buf) { missing = true; break; }
							entries.push({ binding: exp.binding, resource: { buffer: buf } });
							break;
						}
						case 'texture': {
							const view = this.textureBindings.get(exp.binding);
							if (!view) { missing = true; break; }
							entries.push({ binding: exp.binding, resource: view });
							break;
						}
						case 'sampler': {
							const samp = this.samplerBindings.get(exp.binding);
							if (!samp) { missing = true; break; }
							entries.push({ binding: exp.binding, resource: samp });
							break;
						}
					}
				}
				if (!missing && entries.length === expectList.length) {
					bg = this.device.createBindGroup({ layout, entries });
				this.bindGroupCache.set(pipelineHandle.id, bg);
			}
		}
		if (bg && enc) enc.setBindGroup(0, bg);
	}

	draw(pass: PassEncoder, first: number, count: number): void { const enc = (pass as WebGPUPassEncoder).encoder ?? this._activePassEncoder; if (enc) enc.draw(count, 1, first, 0); }
	drawIndexed(pass: PassEncoder, indexCount: number, firstIndex: number, _indexType?: number): void { const enc = (pass as WebGPUPassEncoder).encoder ?? this._activePassEncoder; if (enc) enc.drawIndexed(indexCount, 1, firstIndex, 0, 0); }
	drawInstanced(pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex = 0, firstInstance = 0): void { const enc = (pass as WebGPUPassEncoder).encoder ?? this._activePassEncoder; if (enc) enc.draw(vertexCount, instanceCount, firstVertex, firstInstance); }
	drawIndexedInstanced(pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex = 0, baseVertex = 0, firstInstance = 0, _indexType?: number): void { const enc = (pass as WebGPUPassEncoder).encoder ?? this._activePassEncoder; if (enc) enc.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, firstInstance); }

	setPassState<S = unknown>(label: RenderPassStateId, state: S): void {
		this.stateRegistry.set(label, state);
	}

	getPassState<S = unknown>(label: RenderPassStateId): S {
		const state = this.stateRegistry.get(label);
		if (state === undefined && !this.stateRegistry.has(label)) {
			throw new Error(`[WebGPUBackend] Render pass state '${String(label)}' is not registered.`);
		}
		return state as S;
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
		this.uniformBindings.set(bindingIndex, buf);
		// Invalidate cached bind groups to reflect new resources
		this.bindGroupCache.clear();
	}

	bindTextureWithSampler(texBinding: number, samplerBinding: number, texture: GPUTexture, samplerDesc?: { mag?: 'nearest' | 'linear'; min?: 'nearest' | 'linear'; wrapS?: 'clamp' | 'repeat'; wrapT?: 'clamp' | 'repeat' }): void {
		const view = texture.createView();
		const mag = samplerDesc && samplerDesc.mag === 'linear' ? 'linear' : 'nearest';
		const min = samplerDesc && samplerDesc.min === 'linear' ? 'linear' : 'nearest';
		const address = (wrap?: 'clamp' | 'repeat'): GPUAddressMode => wrap === 'repeat' ? 'repeat' : 'clamp-to-edge';
		const wrapS = samplerDesc?.wrapS;
		const wrapT = samplerDesc?.wrapT;
		const sampler = this.device.createSampler({ magFilter: mag, minFilter: min, addressModeU: address(wrapS), addressModeV: address(wrapT) });
		this.textureBindings.set(texBinding, view);
		this.samplerBindings.set(samplerBinding, sampler);
		this.bindGroupCache.clear();
	}

}
