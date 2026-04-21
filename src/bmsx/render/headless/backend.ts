import { clamp } from '../../common/clamp';
import type { color_arr, TextureSource } from '../../rompack/format';
import type {
	GPUBackend,
	TextureHandle,
	TextureParams,
	RenderPassDesc,
	PassEncoder,
	RenderPassInstanceHandle,
	RenderPassId,
} from '../backend/interfaces';

type HeadlessTextureRecord = {
	id: number;
	kind: string;
	width: number;
	height: number;
	pixels: Uint8Array | null;
	cubemapFaces: Array<Uint8Array | null> | null;
};

type HeadlessBufferRecord = {
	id: number;
	usage: 'static' | 'dynamic';
	bytes: Uint8Array;
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

function toBytes(data: ArrayBufferView): Uint8Array {
	return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

function textureByteLength(width: number, height: number): number {
	return width * height * 4;
}

function colorChannelToByte(value: number): number {
	return Math.round(clamp(value, 0, 1) * 255);
}

function createSolidPixels(width: number, height: number, rgba: color_arr): Uint8Array {
	const pixels = new Uint8Array(textureByteLength(width, height));
	const r = colorChannelToByte(rgba[0]);
	const g = colorChannelToByte(rgba[1]);
	const b = colorChannelToByte(rgba[2]);
	const a = colorChannelToByte(rgba[3]);
	for (let i = 0; i < pixels.byteLength; i += 4) {
		pixels[i] = r;
		pixels[i + 1] = g;
		pixels[i + 2] = b;
		pixels[i + 3] = a;
	}
	return pixels;
}

function asTextureSourcePromise(src: TextureSource | Promise<TextureSource>): Promise<TextureSource> | null {
	if (src instanceof Promise) {
		return src;
	}
	return null;
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
	private frameStats: HeadlessFrameStats = createFrameStats();

	private getTextureId(handle: TextureHandle): number {
		return (handle as unknown as { id: number }).id;
	}

	private getTextureRecord(handle: TextureHandle): HeadlessTextureRecord {
		const id = this.getTextureId(handle);
		const record = this.textures.get(id);
		if (!record) {
			throw new Error(`[HeadlessBackend] Texture handle ${id} is not tracked.`);
		}
		return record;
	}

	private createTextureRecord(kind: string, width: number, height: number, pixels: Uint8Array | null, cubemapFaces: Array<Uint8Array | null> | null): TextureHandle {
		const handle = makeTextureHandle(kind);
		const id = this.getTextureId(handle);
		this.textures.set(id, { id, kind, width, height, pixels, cubemapFaces });
		return handle;
	}

	private createBufferRecord(
		recordMap: Map<number, HeadlessBufferRecord>,
		kind: 'vertex' | 'uniform',
		usage: 'static' | 'dynamic',
		bytes: Uint8Array,
	): unknown {
		const id = ++bufferIdSeq;
		recordMap.set(id, { id, usage, bytes });
		this.accountUpload(kind, bytes.byteLength);
		return { id, kind: `${kind}-buffer` };
	}

	private normalizeTextureSource(src: TextureSource): Uint8Array {
		const expectedBytes = textureByteLength(src.width, src.height);
		if (!src.data) {
			return new Uint8Array(expectedBytes);
		}
		const bytes = src.data;
		if (bytes.byteLength === expectedBytes) {
			return new Uint8Array(bytes);
		}
		const normalized = new Uint8Array(expectedBytes);
		normalized.set(bytes.subarray(0, Math.min(bytes.byteLength, expectedBytes)));
		return normalized;
	}

	private applyTextureSource(record: HeadlessTextureRecord, src: TextureSource): void {
		record.width = src.width;
		record.height = src.height;
		record.pixels = this.normalizeTextureSource(src);
		record.cubemapFaces = null;
		this.accountUpload('texture', textureByteLength(src.width, src.height));
	}

	private ensureTexturePixels(record: HeadlessTextureRecord): Uint8Array {
		if (!record.pixels || record.pixels.byteLength !== textureByteLength(record.width, record.height)) {
			record.pixels = new Uint8Array(textureByteLength(record.width, record.height));
		}
		return record.pixels;
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

	createTexture(src: TextureSource | Promise<TextureSource>, desc: TextureParams): TextureHandle {
		const width = desc.size ? desc.size.x : 1;
		const height = desc.size ? desc.size.y : 1;
		const handle = this.createTextureRecord('texture', width, height, new Uint8Array(textureByteLength(width, height)), null);
		const promise = asTextureSourcePromise(src);
		if (promise) {
			void promise.then(this.updateTexture.bind(this, handle));
			return handle;
		}
		this.updateTexture(handle, src as TextureSource);
		return handle;
	}

	updateTexture(handle: TextureHandle, src: TextureSource): void {
		const record = this.getTextureRecord(handle);
		this.applyTextureSource(record, src);
	}

	resizeTexture(handle: TextureHandle, width: number, height: number, _desc: TextureParams): TextureHandle {
		const record = this.getTextureRecord(handle);
		record.width = width;
		record.height = height;
		record.pixels = new Uint8Array(textureByteLength(width, height));
		record.cubemapFaces = null;
		return handle;
	}

	updateTextureRegion(handle: TextureHandle, src: TextureSource, x: number, y: number): void {
		const record = this.getTextureRecord(handle);
		if (record.cubemapFaces) {
			throw new Error('[HeadlessBackend] Cannot write 2D texture region into cubemap texture.');
		}
		const srcWidth = src.width;
		const srcHeight = src.height;
		if (x < 0 || y < 0 || x + srcWidth > record.width || y + srcHeight > record.height) {
			throw new Error(`[HeadlessBackend] Texture region ${srcWidth}x${srcHeight}@${x},${y} out of bounds for ${record.width}x${record.height}.`);
		}
		const dstPixels = this.ensureTexturePixels(record);
		const srcPixels = this.normalizeTextureSource(src);
		const dstStride = record.width * 4;
		const srcStride = srcWidth * 4;
		for (let row = 0; row < srcHeight; row += 1) {
			const srcOffset = row * srcStride;
			const dstOffset = (y + row) * dstStride + x * 4;
			dstPixels.set(srcPixels.subarray(srcOffset, srcOffset + srcStride), dstOffset);
		}
		this.accountUpload('texture', textureByteLength(srcWidth, srcHeight));
	}

	readTextureRegion(handle: TextureHandle, x: number, y: number, width: number, height: number, out?: Uint8Array): Uint8Array {
		const record = this.getTextureRecord(handle);
		if (record.cubemapFaces) {
			throw new Error('[HeadlessBackend] readTextureRegion only supports 2D textures.');
		}
		if (x < 0 || y < 0 || x + width > record.width || y + height > record.height) {
			throw new Error(`[HeadlessBackend] Texture read ${width}x${height}@${x},${y} out of bounds for ${record.width}x${record.height}.`);
		}
		const src = this.ensureTexturePixels(record);
		const byteLength = textureByteLength(width, height);
		const pixels = out && out.byteLength >= byteLength ? out : new Uint8Array(byteLength);
		const srcStride = record.width * 4;
		const outStride = width * 4;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * srcStride + x * 4;
			const outOffset = row * outStride;
			pixels.set(src.subarray(srcOffset, srcOffset + outStride), outOffset);
		}
		return pixels;
	}

	createSolidTexture2D(width: number, height: number, rgba: color_arr, _desc: TextureParams = {}): TextureHandle {
		const pixels = createSolidPixels(width, height, rgba);
		this.accountUpload('texture', pixels.byteLength);
		return this.createTextureRecord('solid2d', width, height, pixels, null);
	}

	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], _desc: TextureParams): TextureHandle {
		const width = faces[0].width;
		const height = faces[0].height;
		const facePixels = faces.map((face) => {
			if (face.width !== width || face.height !== height) {
				throw new Error('[HeadlessBackend] Cubemap faces must all have identical dimensions.');
			}
			const normalized = this.normalizeTextureSource(face);
			this.accountUpload('texture', normalized.byteLength);
			return normalized;
		});
		return this.createTextureRecord('cubemap', width, height, null, facePixels);
	}

	createSolidCubemap(size: number, rgba: color_arr, _desc: TextureParams): TextureHandle {
		const face = createSolidPixels(size, size, rgba);
		const faces: Array<Uint8Array> = [];
		for (let i = 0; i < 6; i += 1) {
			faces.push(new Uint8Array(face));
		}
		this.accountUpload('texture', face.byteLength * 6);
		return this.createTextureRecord('solidCubemap', size, size, null, faces);
	}

	createCubemapEmpty(size: number, _desc: TextureParams): TextureHandle {
		const faces: Array<Uint8Array> = [];
		for (let i = 0; i < 6; i += 1) {
			faces.push(new Uint8Array(textureByteLength(size, size)));
		}
		return this.createTextureRecord('cubemapEmpty', size, size, null, faces);
	}

	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void {
		const record = this.getTextureRecord(cubemap);
		if (!record.cubemapFaces) {
			throw new Error('[HeadlessBackend] uploadCubemapFace requires a cubemap texture.');
		}
		if (face < 0 || face >= 6) {
			throw new Error(`[HeadlessBackend] Cubemap face index ${face} out of range.`);
		}
		if (src.width !== record.width || src.height !== record.height) {
			throw new Error(`[HeadlessBackend] Cubemap face size mismatch: expected ${record.width}x${record.height}, got ${src.width}x${src.height}.`);
		}
		const pixels = this.normalizeTextureSource(src);
		record.cubemapFaces[face] = pixels;
		this.accountUpload('texture', pixels.byteLength);
	}

	destroyTexture(handle: TextureHandle): void {
		const id = this.getTextureId(handle);
		this.textures.delete(id);
	}

	copyTextureRegion(source: TextureHandle, destination: TextureHandle, srcX: number, srcY: number, dstX: number, dstY: number, width: number, height: number): void {
		const srcRecord = this.getTextureRecord(source);
		const dstRecord = this.getTextureRecord(destination);
		if (srcRecord.cubemapFaces || dstRecord.cubemapFaces) {
			throw new Error('[HeadlessBackend] copyTextureRegion only supports 2D textures.');
		}
		const srcPixels = this.ensureTexturePixels(srcRecord);
		const dstPixels = this.ensureTexturePixels(dstRecord);
		const srcStride = srcRecord.width * 4;
		const dstStride = dstRecord.width * 4;
		const rowBytes = width * 4;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (srcY + row) * srcStride + srcX * 4;
			const dstOffset = (dstY + row) * dstStride + dstX * 4;
			dstPixels.set(srcPixels.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
		}
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

	clear(_opts: { color?: color_arr; depth?: number }): void { }

	beginRenderPass(desc: RenderPassDesc): PassEncoder {
		return { fbo: null, desc };
	}

	endRenderPass(_pass: PassEncoder): void { }

	getCaps(): { maxColorAttachments: number } {
		return { maxColorAttachments: 1 };
	}

	transitionTexture(_tex: TextureHandle, _fromLayout: string, _toLayout: string): void { }

	createRenderPassInstance(desc: { label?: string }): RenderPassInstanceHandle {
		return { id: ++passIdSeq, label: desc.label };
	}

	destroyRenderPassInstance(_p: RenderPassInstanceHandle): void { }

	setGraphicsPipeline(_pass: PassEncoder, _pipeline: RenderPassInstanceHandle): void { }

	draw(_pass: PassEncoder, _first: number, _count: number): void {
		this.frameStats.draws += 1;
	}

	drawIndexed(_pass: PassEncoder, _indexCount: number): void {
		this.frameStats.drawIndexed += 1;
	}

	drawInstanced(_pass: PassEncoder, _vertexCount: number, _instanceCount: number): void {
		this.frameStats.drawsInstanced += 1;
	}

	drawIndexedInstanced(_pass: PassEncoder, _indexCount: number, _instanceCount: number): void {
		this.frameStats.drawIndexedInstanced += 1;
	}

	createVertexBuffer(data: ArrayBufferView, usage: 'static' | 'dynamic'): unknown {
		const bytes = toBytes(data);
		return this.createBufferRecord(this.vertexBuffers, 'vertex', usage, bytes);
	}

	updateVertexBuffer(buf: unknown, data: ArrayBufferView, dstOffset = 0): void {
		const id = (buf as { id: number }).id;
		const record = this.vertexBuffers.get(id);
		if (!record) {
			throw new Error(`[HeadlessBackend] Vertex buffer ${id} is not tracked.`);
		}
		const src = toBytes(data);
		const needed = dstOffset + src.byteLength;
		if (needed > record.bytes.byteLength) {
			const grown = new Uint8Array(needed);
			grown.set(record.bytes, 0);
			record.bytes = grown;
		}
		record.bytes.set(src, dstOffset);
		this.accountUpload('vertex', src.byteLength);
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
		const bytes = new Uint8Array(byteSize);
		return this.createBufferRecord(this.uniformBuffers, 'uniform', usage, bytes);
	}

	updateUniformBuffer(buf: unknown, data: ArrayBufferView, dstByteOffset = 0): void {
		const id = (buf as { id: number }).id;
		const record = this.uniformBuffers.get(id);
		if (!record) {
			throw new Error(`[HeadlessBackend] Uniform buffer ${id} is not tracked.`);
		}
		const src = toBytes(data);
		const needed = dstByteOffset + src.byteLength;
		if (needed > record.bytes.byteLength) {
			const grown = new Uint8Array(needed);
			grown.set(record.bytes, 0);
			record.bytes = grown;
		}
		record.bytes.set(src, dstByteOffset);
		this.accountUpload('uniform', src.byteLength);
	}

	bindUniformBufferBase(_bindingIndex: number, _buf: unknown): void { }

	beginFrame(): void {
		this.frameStats = createFrameStats();
	}

	endFrame(): void { }

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
