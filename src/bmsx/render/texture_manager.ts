import { TextureLoadBarrier } from './texture_load_barrier';
import { GateGroup, taskGate } from '../core/taskgate';
import { type TextureSource } from '../rompack/format';
import { GPUBackend, TextureHandle, TextureParams } from './backend/interfaces';

export type TextureKey = string;
export type ImageKey = string;

interface ImageCacheEntry {
	bitmap?: TextureSource;
	promise?: Promise<TextureSource>;
	refCount: number;
}

interface GPUCacheEntry {
	handle?: TextureHandle;
	refCount: number;
	ownedFallback?: boolean; // true only if this manager created it
	barrier?: TextureLoadBarrier<TextureHandle>;
}

export class TextureManager {
	static _instance: TextureManager;
	static get instance(): TextureManager { return this._instance; } // constructed elsewhere

	private imageCache = new Map<ImageKey, ImageCacheEntry>(); // currently used only for future dedupe
	private gpuCache = new Map<TextureKey, GPUCacheEntry>();
	private textureBarrier: TextureLoadBarrier<TextureHandle>;
	private readonly destroyTextureHandle = (handle: TextureHandle): void => {
		this.backend.destroyTexture(handle);
	};

	constructor(private backend: GPUBackend, private defaultGroup: GateGroup = taskGate.group('texture:default')) {
		this.textureBarrier = new TextureLoadBarrier<TextureHandle>(this.defaultGroup);
		TextureManager._instance = this;
	}
	public setBackend(backend: GPUBackend): void { this.backend = backend; }

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

	private makeKey(uri: string, desc: TextureParams): TextureKey {
		return `${uri}|${this.textureParamsKey(desc)}`;
	}


	/** Non-blocking: install fallback (optional), kick async upload, return key immediately. */
	public acquireTexture(
		key: TextureKey,
		loadBitmapFn: () => Promise<TextureSource>,
		desc: TextureParams = {},
		fallbackHandle?: TextureHandle,
	): TextureKey {
		if (!this.backend) throw new Error('TextureManager backend not set');

		const gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }

			// Put fallback or empty entry
			this.gpuCache.set(key, { handle: fallbackHandle, refCount: 1, ownedFallback: false, barrier: this.textureBarrier });

		void this.textureBarrier.acquire(
				key,
				async () => {
					const bmp = await loadBitmapFn() as TextureSource;
					const real = this.backend!.createTexture(bmp, desc);
					if ('close' in bmp) (bmp as { close: () => void }).close();
					return real;
				},
					{
						category: 'texture',
						block_render: false,
						tag: `tex:${key}`,
						disposer: this.destroyTextureHandle,
						warnIfLongerMs: 1000,
					}
					).then((realHandle) => {
				const entry = this.gpuCache.get(key);
				if (!entry) { this.destroyTextureHandle(realHandle); return; }
				if (entry.handle !== realHandle) {
					const old = entry.handle;
					entry.handle = realHandle;
					// Destroy only manager-owned fallbacks
					if (old && entry.ownedFallback) this.destroyTextureHandle(old);
					entry.ownedFallback = false;
				}
			}).catch((err) => {
				console.error(`Texture acquire failed for key=${key}`, err);
			});

		return key;
	}


	public createTextureFromPixelsSync(keyBase: string, pixels: Uint8Array, width: number, height: number, desc: TextureParams = {}): TextureHandle {
		const key = this.makeKey(keyBase, desc);
		const existing = this.gpuCache.get(key);
		if (existing) {
			return existing.handle;
		}
		const source: TextureSource = { width, height, data: pixels };
		const handle = this.backend.createTexture(source, desc);
		this.gpuCache.set(key, { handle, refCount: 1, ownedFallback: false, barrier: this.textureBarrier });
		void this.textureBarrier.acquire(
			key,
			async () => handle,
			{
				category: 'texture',
				block_render: false,
				tag: `tex:${key}`,
				disposer: this.destroyTextureHandle,
			}
		);
		return handle;
	}

	public updateTexture(handle: TextureHandle, pixels: Uint8Array, width: number, height: number): void {
		if (!this.backend) throw new Error('TextureManager backend not set');
		if (!handle) throw new Error('TextureManager: invalid texture handle');
		this.backend.updateTexture(handle, { width, height, data: pixels });
	}

	public resizeTextureForKey(keyBase: string, width: number, height: number, desc: TextureParams = {}): TextureHandle {
		if (!this.backend) throw new Error('TextureManager backend not set');
		if (width <= 0 || height <= 0) {
			throw new Error('TextureManager: invalid resize dimensions');
		}
		const prefix = `${keyBase}|`;
		let updated = false;
		let updatedHandle: TextureHandle = null;
		for (const key of this.gpuCache.keys()) {
			if (!key.startsWith(prefix)) {
				continue;
			}
			const entry = this.gpuCache.get(key);
			if (!entry || !entry.handle) {
				throw new Error(`TextureManager: texture '${keyBase}' is not initialized.`);
			}
				const newHandle = this.backend.resizeTexture(entry.handle, width, height, desc);
				if (newHandle !== entry.handle) {
					this.textureBarrier.replaceValue(key, newHandle, this.destroyTextureHandle);
					entry.handle = newHandle;
					entry.ownedFallback = false;
				}
			updated = true;
			updatedHandle = entry.handle;
		}
		if (!updated) {
			throw new Error(`TextureManager: texture '${keyBase}' not found for resize.`);
		}
		return updatedHandle;
	}

	public updateTextureRegionForKey(keyBase: string, pixels: Uint8Array, width: number, height: number, x: number, y: number): void {
		if (!this.backend) throw new Error('TextureManager backend not set');
		if (width <= 0 || height <= 0) {
			return;
		}
		const prefix = `${keyBase}|`;
		const source: TextureSource = { width, height, data: pixels };
		for (const key of this.gpuCache.keys()) {
			if (!key.startsWith(prefix)) {
				continue;
			}
			const entry = this.gpuCache.get(key);
			if (!entry || !entry.handle) {
				continue;
			}
			this.backend.updateTextureRegion(entry.handle, source, x, y);
		}
	}

	public getImage(key: ImageKey): TextureSource {
		return this.imageCache.get(key)?.bitmap;
	}

	async fromBuffer(uri: string, buffer?: ArrayBuffer, flipY = false): Promise<TextureSource> {
		let entry = this.imageCache.get(uri);
		if (entry) {
			if (entry.bitmap) {
				// Closed ImageBitmaps report zero dimensions; drop them so we can re-decode.
				if (entry.bitmap.width === 0 || entry.bitmap.height === 0) {
					entry.bitmap = undefined;
				} else {
					return entry.bitmap;
				}
			}
			if (entry.promise) return entry.promise;
		} else {
			entry = { bitmap: undefined, promise: undefined, refCount: 0 };
			this.imageCache.set(uri, entry);
		}
		entry.refCount++;

		if (!entry.promise) {
			entry.promise = (async () => {
				if (!buffer) throw new Error(`No buffer provided to load image '${uri}'`);
				const blob = new Blob([buffer]);
				const img = await createImageBitmap(blob, {
					imageOrientation: flipY ? 'flipY' : 'none',
					premultiplyAlpha: 'none',
					colorSpaceConversion: 'none',
				});
				entry!.bitmap = img;
				entry!.promise = undefined;
				return img;
			})();
		}

		return entry.promise;
	}

	public getTexture(key: TextureKey): TextureHandle {
		return this.gpuCache.get(key)?.handle;
	}

	public getTextureByUri(uri: string, desc: TextureParams = {}): TextureHandle {
		const key = this.makeKey(uri, desc);
		return this.getTexture(key);
	}

	public swapTextureHandlesByUri(uriA: string, uriB: string, descA: TextureParams = {}, descB: TextureParams = {}): void {
		const keyA = this.makeKey(uriA, descA);
		const keyB = this.makeKey(uriB, descB);
		const entryA = this.gpuCache.get(keyA);
		const entryB = this.gpuCache.get(keyB);
		if (!entryA || !entryA.handle) {
			throw new Error(`TextureManager: texture '${uriA}' is not initialized.`);
		}
		if (!entryB || !entryB.handle) {
			throw new Error(`TextureManager: texture '${uriB}' is not initialized.`);
		}
		let swap: TextureHandle | boolean = entryA.handle;
		entryA.handle = entryB.handle;
		entryB.handle = swap as TextureHandle;
		swap = entryA.ownedFallback;
		entryA.ownedFallback = entryB.ownedFallback;
		entryB.ownedFallback = swap as boolean;
	}

	public copyTextureByUri(sourceUri: string, destinationUri: string, width: number, height: number, sourceDesc: TextureParams = {}, destinationDesc: TextureParams = {}): void {
		if (!this.backend) throw new Error('TextureManager backend not set');
		const sourceEntry = this.gpuCache.get(this.makeKey(sourceUri, sourceDesc));
		if (!sourceEntry || !sourceEntry.handle) {
			throw new Error(`TextureManager: texture '${sourceUri}' is not initialized.`);
		}
		const destinationEntry = this.gpuCache.get(this.makeKey(destinationUri, destinationDesc));
		if (!destinationEntry || !destinationEntry.handle) {
			throw new Error(`TextureManager: texture '${destinationUri}' is not initialized.`);
		}
		this.backend.copyTextureRegion(sourceEntry.handle, destinationEntry.handle, 0, 0, 0, 0, width, height);
	}

	public releaseByUri(uri: string, desc: TextureParams = {}): void {
		const key = this.makeKey(uri, desc);
		this.releaseByKey(key);
	}

	public releaseByKey(key: TextureKey): void {
		const e = this.gpuCache.get(key);
		if (!e) return;
		e.refCount--;
			if (e.refCount <= 0) {
				// Let the barrier dispose the real handle
				const barrier = e.barrier ?? this.textureBarrier;
				barrier.release(key, this.destroyTextureHandle);
				// Dispose manager-owned fallback if still present (barrier never saw it)
				if (e.ownedFallback && e.handle) this.destroyTextureHandle(e.handle);
				this.gpuCache.delete(key);
			}
	}

	public clear(): void {
		// Dispose any manager-owned fallbacks that never entered the barrier
			for (const entry of this.gpuCache.values()) {
				if (entry.ownedFallback && entry.handle) this.destroyTextureHandle(entry.handle);
			}
			this.gpuCache.clear();
			// Dispose everything the barrier owns
			this.textureBarrier.clear(this.destroyTextureHandle);
			this.imageCache.clear();
		}
	}
