import { GPUBackend, TextureHandle } from './backend/backend';
import { DEFAULT_TEXTURE_PARAMS, type TextureParams } from './backend/texture_params';

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
		const srgb = desc.srgb ? 1 : 0;
		return `size=${size.x.toFixed(3)}x${size.y.toFixed(3)}|srgb=${srgb}|wrapS=${desc.wrapS}|wrapT=${desc.wrapT}|minFilter=${desc.minFilter}|magFilter=${desc.magFilter}`;
	}

	public makeKey(uri: string, desc: TextureParams = DEFAULT_TEXTURE_PARAMS): TextureKey {
		return `${uri}|${this.textureParamsKey(desc)}`;
	}

	public createTextureFromPixelsSync(keyBase: string, pixels: Uint8Array, width: number, height: number, desc: TextureParams = DEFAULT_TEXTURE_PARAMS): TextureHandle {
		const key = this.makeKey(keyBase, desc);
		const existing = this.gpuCache.get(key);
		if (existing) {
			return existing.handle;
		}
		const handle = this.backend.createTexture(pixels, width, height, desc);
		this.gpuCache.set(key, { handle, desc });
		return handle;
	}

	public resizeTextureForKey(keyBase: string, width: number, height: number, desc: TextureParams = DEFAULT_TEXTURE_PARAMS): TextureHandle {
		const key = this.makeKey(keyBase, desc);
		const entry = this.gpuCache.get(key)!;
		const handle = this.backend.resizeTexture(entry.handle, width, height, entry.desc);
		entry.handle = handle;
		return handle;
	}

	public getTexture(key: TextureKey): TextureHandle {
		return this.gpuCache.get(key)!.handle;
	}

	public getTextureByUri(uri: string, desc: TextureParams = DEFAULT_TEXTURE_PARAMS): TextureHandle {
		return this.getTexture(this.makeKey(uri, desc));
	}

	public swapTextureHandlesByUri(uriA: string, uriB: string, descA: TextureParams = DEFAULT_TEXTURE_PARAMS, descB: TextureParams = DEFAULT_TEXTURE_PARAMS): void {
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
