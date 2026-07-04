import type { color_arr, TextureSource } from '../../rompack/format';
import {
	type GPUBackend,
	type BackendCaps,
	type TextureHandle,
	type RenderPassDesc,
	type PassEncoder,
	type RenderPassInstanceHandle,
	type RenderPassId,
} from '../backend/backend';
import type { TextureParams } from '../backend/texture_params';
import { createSolidRgba8Pixels } from '../shared/solid_pixels';
import type { RenderPassLibrary } from '../backend/pass/library';
import { registerHeadlessPasses, registerHeadlessPresentPass } from './passes';
import { registerHostOverlayPass_Headless, registerHostMenuPass_Headless } from '../host_overlay/headless/pipeline';

type HeadlessTextureRecord = {
	id: number;
	kind: string;
	width: number;
	height: number;
	pixels: Uint8Array | null;
	cubemapFaces: [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null] | null;
};

type HeadlessBufferRecord = {
	id: number;
	usage: 'static' | 'dynamic';
	byteLength: number;
};

type HeadlessFrameStats = {
	draws: number;
	drawIndexed: number;
	drawsInstanced: number;
	drawIndexedInstanced: number;
	bytesUploaded: number;
	vertexBytes: number;
	indexBytes: number;
	uniformBytes: number;
	textureBytes: number;
};

let textureIdSeq = 0;
let passIdSeq = 0;
let bufferIdSeq = 0;
let vaoIdSeq = 0;

function makeTextureHandle(kind: string): TextureHandle {
	return { id: ++textureIdSeq, kind } as TextureHandle;
}

function createFrameStats(): HeadlessFrameStats {
	return {
		draws: 0,
		drawIndexed: 0,
		drawsInstanced: 0,
		drawIndexedInstanced: 0,
		bytesUploaded: 0,
		vertexBytes: 0,
		indexBytes: 0,
		uniformBytes: 0,
		textureBytes: 0,
	};
}

function arrayBufferViewElementCount(data: ArrayBufferView): number {
	const bytesPerElement = arrayBufferViewBytesPerElement(data);
	const sized = data as ArrayBufferView & { readonly length?: number };
	return data instanceof DataView ? data.byteLength : sized.length ?? data.byteLength / bytesPerElement;
}

function arrayBufferViewBytesPerElement(data: ArrayBufferView): number {
	const sized = data as ArrayBufferView & { readonly BYTES_PER_ELEMENT?: number };
	return data instanceof DataView ? 1 : sized.BYTES_PER_ELEMENT ?? 1;
}

function textureByteLength(width: number, height: number): number {
	return width * height * 4;
}

export class HeadlessGPUBackend implements GPUBackend {
	public context: any = null;
	public readonly type = 'headless';
	private readonly state = new Map<string, unknown>();
	private readonly textures = new Map<number, HeadlessTextureRecord>();
	private readonly vertexBuffers = new Map<number, HeadlessBufferRecord>();
	private readonly uniformBuffers = new Map<number, HeadlessBufferRecord>();
	private readonly vaos = new Set<number>();
	private readonly bound2DByUnit = new Map<number, TextureHandle>();
	private readonly boundCubeByUnit = new Map<number, TextureHandle>();
	private activeTextureUnit = 0;
	private readonly frameStats: HeadlessFrameStats = createFrameStats();
	private readonly passEncoderScratch: PassEncoder = { fbo: null, desc: {} };

	registerBuiltinPasses(registry: RenderPassLibrary): void {
		registerHeadlessPasses(registry);
		registerHostOverlayPass_Headless(registry);
		registerHostMenuPass_Headless(registry);
		registerHeadlessPresentPass(registry);
	}

	private getTextureId(handle: TextureHandle): number {
		return (handle as unknown as { id: number }).id;
	}

	private getTextureRecord(handle: TextureHandle): HeadlessTextureRecord {
		return this.textures.get(this.getTextureId(handle))!;
	}

	private createTextureRecord(
		kind: string,
		width: number,
		height: number,
		pixels: Uint8Array | null,
		cubemapFaces: [Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null, Uint8Array | null] | null,
	): TextureHandle {
		const handle = makeTextureHandle(kind);
		const id = this.getTextureId(handle);
		this.textures.set(id, { id, kind, width, height, pixels, cubemapFaces });
		return handle;
	}

	private textureSourcePixels(src: TextureSource): Uint8Array {
		return src.data!;
	}

	private texturePixels(record: HeadlessTextureRecord): Uint8Array {
		return record.pixels!;
	}

	setActiveTexture(unit: number): void {
		this.activeTextureUnit = unit;
	}

	bindTexture2D(tex: TextureHandle): void {
		this.bound2DByUnit.set(this.activeTextureUnit, tex);
	}

	bindTextureCube(tex: TextureHandle): void {
		this.boundCubeByUnit.set(this.activeTextureUnit, tex);
	}

	createTexture(data: Uint8Array, width: number, height: number, _desc: TextureParams): TextureHandle {
		this.accountUpload('texture', textureByteLength(width, height));
		return this.createTextureRecord('texture', width, height, data, null);
	}

	updateTexture(handle: TextureHandle, data: Uint8Array, width: number, height: number, _desc: TextureParams): void {
		const record = this.getTextureRecord(handle);
		record.width = width;
		record.height = height;
		record.pixels = data;
		record.cubemapFaces = null;
		this.accountUpload('texture', textureByteLength(width, height));
	}

	resizeTexture(handle: TextureHandle, width: number, height: number, _desc: TextureParams): TextureHandle {
		const record = this.getTextureRecord(handle);
		record.width = width;
		record.height = height;
		record.pixels = new Uint8Array(textureByteLength(width, height));
		record.cubemapFaces = null;
		return handle;
	}

	updateTextureRegion(handle: TextureHandle, data: Uint8Array, width: number, height: number, x: number, y: number, _desc: TextureParams, sourceOffset = 0): void {
		const record = this.getTextureRecord(handle);
		const dstPixels = this.texturePixels(record);
		const dstStride = record.width * 4;
		const srcStride = width * 4;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = sourceOffset + row * srcStride;
			const dstOffset = (y + row) * dstStride + x * 4;
			for (let index = 0; index < srcStride; index += 1) {
				dstPixels[dstOffset + index] = data[srcOffset + index];
			}
		}
		this.accountUpload('texture', textureByteLength(width, height));
	}

	readTextureRegion(handle: TextureHandle, out: Uint8Array, width: number, height: number, x: number, y: number, _desc: TextureParams): void {
		const record = this.getTextureRecord(handle);
		const src = this.texturePixels(record);
		const srcStride = record.width * 4;
		const outStride = width * 4;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * srcStride + x * 4;
			const outOffset = row * outStride;
			for (let index = 0; index < outStride; index += 1) {
				out[outOffset + index] = src[srcOffset + index];
			}
		}
	}

	createSolidTexture2D(width: number, height: number, color: number, _desc: TextureParams): TextureHandle {
		const pixels = createSolidRgba8Pixels(width, height, color);
		this.accountUpload('texture', pixels.byteLength);
		return this.createTextureRecord('solid2d', width, height, pixels, null);
	}


	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], _desc: TextureParams): TextureHandle {
		const width = faces[0].width;
		const height = faces[0].height;
		const facePixels: [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array] = [
			this.textureSourcePixels(faces[0]),
			this.textureSourcePixels(faces[1]),
			this.textureSourcePixels(faces[2]),
			this.textureSourcePixels(faces[3]),
			this.textureSourcePixels(faces[4]),
			this.textureSourcePixels(faces[5]),
		];
		for (let faceIndex = 0; faceIndex < 6; faceIndex += 1) {
			this.accountUpload('texture', facePixels[faceIndex].byteLength);
		}
		return this.createTextureRecord('cubemap', width, height, null, facePixels);
	}

	createSolidCubemap(size: number, color: number, _desc: TextureParams): TextureHandle {
		const faces: [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array] = [
			createSolidRgba8Pixels(size, size, color),
			createSolidRgba8Pixels(size, size, color),
			createSolidRgba8Pixels(size, size, color),
			createSolidRgba8Pixels(size, size, color),
			createSolidRgba8Pixels(size, size, color),
			createSolidRgba8Pixels(size, size, color),
		];
		this.accountUpload('texture', faces[0].byteLength * 6);
		return this.createTextureRecord('solidCubemap', size, size, null, faces);
	}

	createCubemapEmpty(size: number, _desc: TextureParams): TextureHandle {
		const byteLength = textureByteLength(size, size);
		const faces: [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array] = [
			new Uint8Array(byteLength),
			new Uint8Array(byteLength),
			new Uint8Array(byteLength),
			new Uint8Array(byteLength),
			new Uint8Array(byteLength),
			new Uint8Array(byteLength),
		];
		return this.createTextureRecord('cubemapEmpty', size, size, null, faces);
	}

	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void {
		const record = this.getTextureRecord(cubemap);
		const pixels = this.textureSourcePixels(src);
		record.cubemapFaces![face] = pixels;
		this.accountUpload('texture', pixels.byteLength);
	}

	destroyTexture(handle: TextureHandle): void {
		const id = this.getTextureId(handle);
		this.textures.delete(id);
	}

	createColorTexture(desc: { width: number; height: number; format?: unknown }): TextureHandle {
		const handle = makeTextureHandle('color');
		const id = this.getTextureId(handle);
		const pixels = new Uint8Array(textureByteLength(desc.width, desc.height));
		this.textures.set(id, { id, kind: 'color', width: desc.width, height: desc.height, pixels, cubemapFaces: null });
		return handle;
	}

	createDepthTexture(desc: { width: number; height: number; format?: unknown }): TextureHandle {
		const handle = makeTextureHandle('depth');
		const id = this.getTextureId(handle);
		this.textures.set(id, { id, kind: 'depth', width: desc.width, height: desc.height, pixels: null, cubemapFaces: null });
		return handle;
	}

	createRenderTarget(color?: TextureHandle, depth?: TextureHandle): { size: { x: number; y: number }; colors: TextureHandle[]; depth?: TextureHandle } {
		const colors = color ? [color] : [];
		if (color) {
			const c = this.getTextureRecord(color);
			return { size: { x: c.width, y: c.height }, colors, depth };
		}
		if (depth) {
			const d = this.getTextureRecord(depth);
			return { size: { x: d.width, y: d.height }, colors, depth };
		}
		return { size: { x: 0, y: 0 }, colors, depth };
	}

	clear(_color: color_arr | undefined, _depth: number | undefined): void { }

	beginRenderPass(desc: RenderPassDesc): PassEncoder {
		this.passEncoderScratch.fbo = null;
		this.passEncoderScratch.desc = desc;
		return this.passEncoderScratch;
	}

	endRenderPass(_pass: PassEncoder): void { }

	getCaps(): BackendCaps {
		return {
			maxColorAttachments: 1,
			maxTextureSize: 4096,
			supportsInstancing: false,
			supportsDepthTexture: true,
		};
	}

	createRenderPassInstance(desc: { label?: string }): RenderPassInstanceHandle {
		return { id: ++passIdSeq, label: desc.label };
	}

	destroyRenderPassInstance(_p: RenderPassInstanceHandle): void { }

	setGraphicsPipeline(_pass: PassEncoder, _pipeline: RenderPassInstanceHandle): void { }

	draw(_pass: PassEncoder, _first: number, _count: number): void {
		this.frameStats.draws += 1;
	}

	drawIndexed(_pass: PassEncoder, _indexCount: number, _firstIndex: number): void {
		this.frameStats.drawIndexed += 1;
	}

	drawInstanced(_pass: PassEncoder, _vertexCount: number, _instanceCount: number): void {
		this.frameStats.drawsInstanced += 1;
	}

	drawIndexedInstanced(_pass: PassEncoder, _indexCount: number, _instanceCount: number): void {
		this.frameStats.drawIndexedInstanced += 1;
	}

	createVertexBuffer(data: ArrayBufferView, usage: 'static' | 'dynamic'): unknown {
		const id = ++bufferIdSeq;
		this.vertexBuffers.set(id, { id, usage, byteLength: data.byteLength });
		this.accountUpload('vertex', data.byteLength);
		return { id, kind: 'vertex-buffer' };
	}

	updateVertexBuffer(buf: unknown, data: ArrayBufferView, dstOffset = 0, sourceOffset = 0, elementCount?: number): void {
		const id = (buf as { id: number }).id;
		const record = this.vertexBuffers.get(id)!;
		const bytesPerElement = arrayBufferViewBytesPerElement(data);
		const uploadElements = elementCount === undefined ? arrayBufferViewElementCount(data) - sourceOffset : elementCount;
		const uploadBytes = uploadElements * bytesPerElement;
		const needed = dstOffset + uploadBytes;
		if (needed > record.byteLength) {
			record.byteLength = needed;
		}
		this.accountUpload('vertex', uploadBytes);
	}

	bindArrayBuffer(_buf: unknown): void { }

	createVertexArray(): unknown {
		const id = ++vaoIdSeq;
		this.vaos.add(id);
		return { id, kind: 'vertex-array' };
	}

	bindVertexArray(_vao: unknown): void { }

	deleteVertexArray(vao: unknown): void {
		this.vaos.delete((vao as { id: number }).id);
	}

	createUniformBuffer(byteSize: number, usage: 'static' | 'dynamic'): unknown {
		const id = ++bufferIdSeq;
		this.uniformBuffers.set(id, { id, usage, byteLength: byteSize });
		this.accountUpload('uniform', byteSize);
		return { id, kind: 'uniform-buffer' };
	}

	updateUniformBuffer(buf: unknown, data: ArrayBufferView, dstByteOffset = 0): void {
		const id = (buf as { id: number }).id;
		const record = this.uniformBuffers.get(id)!;
		const needed = dstByteOffset + data.byteLength;
		if (needed > record.byteLength) {
			record.byteLength = needed;
		}
		this.accountUpload('uniform', data.byteLength);
	}

	bindUniformBufferBase(_bindingIndex: number, _buf: unknown): void { }

	beginFrame(): void {
		this.frameStats.draws = 0;
		this.frameStats.drawIndexed = 0;
		this.frameStats.drawsInstanced = 0;
		this.frameStats.drawIndexedInstanced = 0;
		this.frameStats.bytesUploaded = 0;
		this.frameStats.vertexBytes = 0;
		this.frameStats.indexBytes = 0;
		this.frameStats.uniformBytes = 0;
		this.frameStats.textureBytes = 0;
	}

	endFrame(): void {
	}

	getFrameStats(): typeof this.frameStats {
		return this.frameStats;
	}

	accountUpload(kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void {
		this.frameStats.bytesUploaded += bytes;
		switch (kind) {
			case 'vertex':
				this.frameStats.vertexBytes += bytes;
				break;
			case 'index':
				this.frameStats.indexBytes += bytes;
				break;
			case 'uniform':
				this.frameStats.uniformBytes += bytes;
				break;
			case 'texture':
				this.frameStats.textureBytes += bytes;
				break;
		}
	}

	setPassState<S>(id: RenderPassId, state: S): void {
		this.state.set(String(id), state);
	}

	getPassState<S>(id: RenderPassId): S {
		return this.state.get(String(id)) as S;
	}
}
