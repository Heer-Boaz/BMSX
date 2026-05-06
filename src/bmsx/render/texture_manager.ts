import { type TextureSource } from '../rompack/format';
import { GPUBackend, TextureHandle, TextureParams } from './backend/interfaces';

export type TextureKey = string;

interface GPUCacheEntry {
	handle: TextureHandle;
	desc: TextureParams;
}

export class TextureManager {
	static _instance: TextureManager;
	static get instance(): TextureManager { return this._instance; }

	private gpuCache = new Map<TextureKey, GPUCacheEntry>();

	constructor(private backend: GPUBackend) {
		TextureManager._instance = this;
	}

	public setBackend(backend: GPUBackend): void {
		if (this.backend !== backend) {
			this.clear();
		}
		this.backend = backend;
	}

	private textureParamsKey(desc: TextureParams): string {
		const size = desc.size;
		const width = size ? size.x : 0;
		const height = size ? size.y : 0;
		const srgb = desc.srgb === false ? 0 : 1;
		const wrapS = desc.wrapS === undefined ? 0 : desc.wrapS;
		const wrapT = desc.wrapT === undefined ? 0 : desc.wrapT;
		const minFilter = desc.minFilter === undefined ? 0 : desc.minFilter;
		const magFilter = desc.magFilter === undefined ? 0 : desc.magFilter;
		return `size=${width.toFixed(3)}x${height.toFixed(3)}|srgb=${srgb}|wrapS=${wrapS}|wrapT=${wrapT}|minFilter=${minFilter}|magFilter=${magFilter}`;
	}

	public makeKey(uri: string, desc: TextureParams = {}): TextureKey {
		return `${uri}|${this.textureParamsKey(desc)}`;
	}

	public createTextureFromPixelsSync(keyBase: string, pixels: Uint8Array, width: number, height: number, desc: TextureParams = {}): TextureHandle {
		const key = this.makeKey(keyBase, desc);
		const existing = this.gpuCache.get(key);
		if (existing) {
			return existing.handle;
		}
		const source: TextureSource = { width, height, data: pixels };
		const handle = this.backend.createTexture(source, desc);
		this.gpuCache.set(key, { handle, desc });
		return handle;
	}

	public resizeTextureForKey(keyBase: string, width: number, height: number, desc: TextureParams = {}): TextureHandle {
		const key = this.makeKey(keyBase, desc);
		const entry = this.gpuCache.get(key)!;
		const handle = this.backend.resizeTexture(entry.handle, width, height, entry.desc);
		entry.handle = handle;
		return handle;
	}

	public getTexture(key: TextureKey): TextureHandle {
		return this.gpuCache.get(key)!.handle;
	}

	public getTextureByUri(uri: string, desc: TextureParams = {}): TextureHandle {
		return this.getTexture(this.makeKey(uri, desc));
	}

	public swapTextureHandlesByUri(uriA: string, uriB: string, descA: TextureParams = {}, descB: TextureParams = {}): void {
		const entryA = this.gpuCache.get(this.makeKey(uriA, descA))!;
		const entryB = this.gpuCache.get(this.makeKey(uriB, descB))!;
		const handle = entryA.handle;
		entryA.handle = entryB.handle;
		entryB.handle = handle;
	}

	public clear(): void {
		for (const entry of this.gpuCache.values()) {
			this.backend.destroyTexture(entry.handle);
		}
		this.gpuCache.clear();
	}
}
