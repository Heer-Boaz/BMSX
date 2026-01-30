import type { color_arr, TextureSource } from '../../rompack/rompack';
import type {
	GPUBackend,
	TextureHandle,
	TextureParams,
	RenderPassDesc,
	PassEncoder,
	RenderPassInstanceHandle,
	RenderPassId,
} from '../backend/pipeline_interfaces';
let textureIdSeq = 0;
let passIdSeq = 0;

function makeTextureHandle(kind: string, extra: Record<string, unknown> = {}): TextureHandle {
	return { id: ++textureIdSeq, kind, ...extra } as TextureHandle;
}

function makePassEncoder(desc: RenderPassDesc): PassEncoder {
	return { fbo: null, desc };
}

export class HeadlessGPUBackend implements GPUBackend {
	public context: any = null;
	public readonly type = 'headless';
	private readonly state = new Map<string, unknown>();

	setActiveTexture(_unit: number): void { }
	bindTexture2D(_tex: TextureHandle): void { }
	bindTextureCube(_tex: TextureHandle): void { }

	createTexture(_src: TextureSource | Promise<TextureSource>, _desc: TextureParams): TextureHandle {
		return makeTextureHandle('texture');
	}
	updateTexture(_handle: TextureHandle, _src: TextureSource): void { }
	updateTextureRegion(_handle: TextureHandle, _src: TextureSource, _x: number, _y: number): void { }
	createSolidTexture2D(_width: number, _height: number, _rgba: color_arr, _desc: TextureParams = {}): TextureHandle {
		return makeTextureHandle('solid2d');
	}
	createCubemapFromSources(_faces: readonly TextureHandle[], _desc: TextureParams): TextureHandle {
		return makeTextureHandle('cubemap');
	}
	createSolidCubemap(_size: number, _rgba: color_arr, _desc: TextureParams): TextureHandle {
		return makeTextureHandle('solidCubemap');
	}
	createCubemapEmpty(_size: number, _desc: TextureParams): TextureHandle {
		return makeTextureHandle('cubemapEmpty');
	}
	uploadCubemapFace(_cubemap: TextureHandle, _face: number, _src: unknown): void { }

	destroyTexture(_handle: TextureHandle): void { }

	createColorTexture(desc: { width: number; height: number; format?: unknown }): TextureHandle {
		return makeTextureHandle('color', desc as Record<string, unknown>);
	}
	createDepthTexture(desc: { width: number; height: number; format?: unknown }): TextureHandle {
		return makeTextureHandle('depth', desc as Record<string, unknown>);
	}
	createRenderTarget(_color?: TextureHandle, _depth?: TextureHandle): { size: { x: number; y: number }; colors: TextureHandle[] } {
		return { size: { x: 0, y: 0 }, colors: [] };
	}

	clear(_opts: { color?: color_arr; depth?: number }): void { }

	beginRenderPass(desc: RenderPassDesc): PassEncoder {
		return makePassEncoder(desc);
	}
	endRenderPass(_pass: PassEncoder): void { }

	getCaps(): { maxColorAttachments: number } {
		return { maxColorAttachments: 1 };
	}

	transitionTexture(_tex: TextureHandle, _fromLayout: string, _toLayout: string): void { }

	createRenderPassInstance(_desc: { label?: string }): RenderPassInstanceHandle {
		return { id: ++passIdSeq, label: _desc.label };
	}
	destroyRenderPassInstance(_p: RenderPassInstanceHandle): void { }
	setGraphicsPipeline(_pass: PassEncoder, _pipeline: RenderPassInstanceHandle): void { }

	draw(_pass: PassEncoder, _first: number, _count: number): void { }
	drawIndexed(_pass: PassEncoder, _indexCount: number): void { }
	drawInstanced(_pass: PassEncoder, _vertexCount: number, _instanceCount: number): void { }
	drawIndexedInstanced(_pass: PassEncoder, _indexCount: number, _instanceCount: number): void { }

	createVertexBuffer(_data: ArrayBufferView, _usage: 'static' | 'dynamic'): unknown { return null; }
	updateVertexBuffer(_buf: unknown, _data: ArrayBufferView, _dstOffset?: number): void { }
	bindArrayBuffer(_buf: unknown): void { }
	createVertexArray(): unknown { return null; }
	bindVertexArray(_vao: unknown): void { }
	deleteVertexArray(_vao: unknown): void { }
	setAttribPointerFloat(_index: number, _size: number, _stride: number, _offset: number): void { }
	setAttribIPointerU8(_index: number, _size: number, _stride: number, _offset: number): void { }
	setAttribIPointerU16(_index: number, _size: number, _stride: number, _offset: number): void { }

	createUniformBuffer(_byteSize: number, _usage: 'static' | 'dynamic'): unknown { return null; }
	updateUniformBuffer(_buf: unknown, _data: ArrayBufferView, _dstByteOffset?: number): void { }
	bindUniformBufferBase(_bindingIndex: number, _buf: unknown): void { }

	beginFrame(): void { }
	endFrame(): void { }
	getFrameStats(): { draws: number; drawIndexed: number; drawsInstanced: number; drawIndexedInstanced: number; bytesUploaded: number } {
		return undefined;
	}
	accountUpload(_kind: 'vertex' | 'index' | 'uniform' | 'texture', _bytes: number): void { }

	setPassState<S>(id: RenderPassId, state: S): void {
		this.state.set(String(id), state);
	}
	getPassState<S>(id: RenderPassId): S {
		return this.state.get(String(id)) as S;
	}
}
