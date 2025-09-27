import { AssetBarrier } from '../core/assetbarrier';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { color_arr, GLTFModel, Identifier, Index2GpuTexture, RegisterablePersistent } from '../rompack/rompack';
import { GPUBackend, TextureHandle, TextureParams } from './backend/pipeline_interfaces';
import { Platform, type TextureSource } from '../core/platform';

export const TEXTMANAGER_ID = 'texmgr';
export type TextureIdentifier = string;

export interface ModelTextureIdentifier {
	modelName: string;
	modelImageIndex: number;
}

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
}

export class TextureManager implements RegisterablePersistent {
	get registrypersistent(): true { return true; }
	public get id(): Identifier { return 'texmgr'; }

	static _instance: TextureManager;
	static get instance(): TextureManager { return this._instance; } // constructed elsewhere

	private imageCache = new Map<ImageKey, ImageCacheEntry>(); // currently used only for future dedupe
	private gpuCache = new Map<TextureKey, GPUCacheEntry>();
	private textureBarrier: AssetBarrier<TextureHandle>;

	constructor(private backend?: GPUBackend, private defaultGroup: GateGroup = taskGate.group('texture:default')) {
		this.textureBarrier = new AssetBarrier<TextureHandle>(this.defaultGroup);
		TextureManager._instance = this;
		this.bind();
	}

	public bind(): void { Registry.instance.register(this); }
	public unbind(): void { Registry.instance.deregister(this); }
	public setBackend(backend: GPUBackend): void { this.backend = backend; }

	private makeKey(uri: string, desc: TextureParams): TextureKey {
		// TODO: canonicalize desc if field order may vary
		const descKey = JSON.stringify(desc);
		return `${uri}|${descKey}`;
	}
	private makeModelBufferKey(identifier: ModelTextureIdentifier): TextureKey {
		return `buf:${identifier.modelName}:${identifier.modelImageIndex}`;
	}
	// allow nullable face ids and nullable face loaders
	private makeCubemapKey(name: string, faceIds: readonly (string | null)[], desc: TextureParams): TextureKey {
		const descKey = JSON.stringify(desc);
		return `cubemap:${name}|faces:${faceIds.join(',')}|${descKey}`;
	}

	/** Ensure real GPU texture exists; returns the key. */
	private async ensureTextureReady(
		key: string,
		loadBitmapFn: () => Promise<TextureSource>,
		desc: TextureParams
	): Promise<TextureKey> {
		if (!this.backend) throw new Error('TextureManager backend not set');

		// Fast path or reserve to avoid race
		let gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }
		this.gpuCache.set(key, { handle: undefined, refCount: 1 }); // reserve entry before awaiting

		const handle = await this.textureBarrier.acquire(
			key,
			async () => {
				const bmp = await loadBitmapFn();
				const h = this.backend!.createTexture(bmp, desc);
				if ('close' in bmp) bmp.close();
				return h;
			},
			{
				category: 'texture',
				block_render: false,
				tag: `tex:${key}`,
				disposer: (h) => this.backend!.destroyTexture(h),
				warnIfLongerMs: 1000,
			}
		);

		// Entry may have been released while loading
		const entry = this.gpuCache.get(key);
		if (!entry) { if (this.backend) this.backend.destroyTexture(handle); return key; }
		entry.handle = handle;
		return key;
	}

	/** Non-blocking: install fallback (optional), kick async upload, return key immediately. */
	public acquireTexture(
		key: TextureKey,
		loadBitmapFn: () => Promise<TextureSource>,
		desc: TextureParams = {},
		fallbackHandle?: TextureHandle,
	): TextureKey {
		if (!this.backend) throw new Error('TextureManager backend not set');

		let gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }

		// Put fallback or empty entry
		this.gpuCache.set(key, { handle: fallbackHandle, refCount: 1, ownedFallback: false });

		void this.textureBarrier.acquire(
			key,
			async () => {
				const bmp = await loadBitmapFn();
				const real = this.backend!.createTexture(bmp, desc);
				if ('close' in bmp) bmp.close();
				return real;
			},
			{
				category: 'texture',
				block_render: false,
				tag: `tex:${key}`,
				disposer: (h) => this.backend!.destroyTexture(h),
				warnIfLongerMs: 1000,
			}
		).then((realHandle) => {
			const entry = this.gpuCache.get(key);
			if (!entry) { if (this.backend) this.backend.destroyTexture(realHandle); return; }
			if (entry.handle !== realHandle) {
				const old = entry.handle;
				entry.handle = realHandle;
				// Destroy only manager-owned fallbacks
				if (old && entry.ownedFallback && this.backend) this.backend.destroyTexture(old);
				entry.ownedFallback = false;
			}
		}).catch(err => {
			console.error(`Texture acquire failed for key=${key}`, err);
		});

		return key;
	}

	// helper: reserve a fallback cubemap entry that we own
	private reserveFallbackCubemap(key: string, desc: TextureParams, fallbackColor: color_arr): void {
		const fallback = this.backend!.createSolidCubemap(1, fallbackColor, desc);
		this.gpuCache.set(key, { handle: fallback, refCount: 1, ownedFallback: true });
	}

	private launchCubemapReplacement(
		key: string,
		acquireFn: () => Promise<TextureHandle>,
		assetBarrier?: AssetBarrier<TextureHandle>,
		tag?: string
	): void {
		const barrier = assetBarrier ?? this.textureBarrier;
		void barrier.acquire(
			key,
			async () => await acquireFn(),
			{
				category: 'texture',
				block_render: !!assetBarrier, // external barrier implies blocking caller wants it visible
				tag: tag ?? `cubemap:${key}`,
				disposer: (h) => this.backend!.destroyTexture(h),
				warnIfLongerMs: 1000,
			}
		).then((real) => {
			const entry = this.gpuCache.get(key);
			if (!entry) { if (this.backend) this.backend.destroyTexture(real); return; }
			const old = entry.handle;
			entry.handle = real;
			if (old && entry.ownedFallback && this.backend) this.backend.destroyTexture(old);
			entry.ownedFallback = false;
		}).catch(err => console.error(`Cubemap acquire failed for key=${key}`, err));
	}

	public acquireCubemap(options: {
		name: string,
		streamed?: boolean;
		delayMs?: number;
		assetBarrier?: AssetBarrier<TextureHandle>,
		// loaders and face ids may be null intentionally (some faces left unset)
		faceLoaders: readonly (Promise<TextureSource> | null)[],
		faceIdsForKey: readonly (string | null)[],
		desc: TextureParams,
		fallbackColor: color_arr,
	}): TextureKey {
		if (!this.backend) throw new Error('TextureManager backend not set');
		const { name, faceIdsForKey, desc, fallbackColor, assetBarrier, faceLoaders, delayMs } = options;

		const key = this.makeCubemapKey(name, faceIdsForKey, desc);

		let gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }

		this.reserveFallbackCubemap(key, desc, fallbackColor);

		const streamed = options.streamed ?? false;

		if (!streamed) {
			this.launchCubemapReplacement(key, async () => {
				if (delayMs) await new Promise(r => setTimeout(r, delayMs));

				// Find first provided loader (if any) to pick face size
				const firstProvidedIndex = faceLoaders.findIndex(p => p != null);
				let targetSize = 1;
				if (firstProvidedIndex >= 0) {
					// await the first provided to know size (it's safe to await promises multiple times)
					const firstImg = await (faceLoaders[firstProvidedIndex] as Promise<TextureSource>);
					targetSize = Math.max(1, firstImg.width, firstImg.height);
				}

				// Build array of promises for all faces, substituting missing faces with solid bitmaps of targetSize
				const promises: Promise<TextureSource>[] = faceLoaders.map(p => p != null ? (p as Promise<TextureSource>) : Platform.instance.textureLoader.createSolid(targetSize, fallbackColor));

				const faces = await Promise.all(promises) as
					[TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource];
				return this.backend!.createCubemapFromSources(faces, desc);
			}, assetBarrier, `cubemap:${name}`);
		} else {
			this.launchCubemapReplacement(key, async () => {
				if (delayMs) await new Promise(r => setTimeout(r, delayMs));

				// Determine size from first available loader (or use 1)
				const firstProvidedIndex = faceLoaders.findIndex(p => p != null);
				let size = 1;
				if (firstProvidedIndex >= 0) {
					const firstImg = await (faceLoaders[firstProvidedIndex] as Promise<TextureSource>);
					size = Math.max(1, firstImg.width, firstImg.height);
				}

				const cubemap = this.backend!.createCubemapEmpty(size, desc);

				// Upload every face: use provided loader or synthesized solid image
				const uploadPromises: Promise<void>[] = faceLoaders.map((p, idx) => {
					if (p != null) {
						return (p as Promise<TextureSource>).then(img => {
							this.backend!.uploadCubemapFace(cubemap, idx, img);
						});
					} else {
						return Platform.instance.textureLoader.createSolid(size, fallbackColor).then(img => {
							this.backend!.uploadCubemapFace(cubemap, idx, img);
						});
					}
				});

				await Promise.all(uploadPromises);
				return cubemap;
			}, assetBarrier, `cubemap:${name}:streamed`);
		}

		return key;
	}

	public async fetchModelTextures(meshModel: GLTFModel): Promise<Index2GpuTexture> {
		const gpuTextures: Index2GpuTexture = {};
		let count = 0;
		if (meshModel.imageBuffers) {
			count = meshModel.imageBuffers.length;
		} else if (meshModel.imageURIs) {
			count = meshModel.imageURIs.length;
		}
		if (count === 0) return gpuTextures;

		for (let i = 0; i < count; i++) {
			if (meshModel.imageBuffers) {
				const buf = meshModel.imageBuffers[i];
				const key = await this.loadModelTextureFromBuffer(buf, { modelName: meshModel.name, modelImageIndex: i });
				gpuTextures[i] = key;
			} else if (meshModel.imageURIs) {
				const uri = meshModel.imageURIs[i];
				if (!uri) continue;
				const key = await this.fetchModelTextureFromUri(uri, { modelName: meshModel.name, modelImageIndex: i });
				gpuTextures[i] = key;
			}
		}
		return gpuTextures;
	}

	public async releaseModelTextures(model: GLTFModel): Promise<void> {
		let count = 0;
		if (model.imageBuffers) {
			count = model.imageBuffers.length;
		} else if (model.imageURIs) {
			count = model.imageURIs.length;
		}
		for (let i = 0; i < count; i++) {
			const key = model.imageBuffers
				? this.makeModelBufferKey({ modelName: model.name, modelImageIndex: i })
				: this.makeKey(model.imageURIs![i], {});
			this.releaseByKey(key);
		}
	}

	private async loadAndCacheTexture(
		key: string,
		loadBitmapFn: () => Promise<TextureSource>,
		desc: TextureParams
	): Promise<TextureKey> {
		return this.ensureTextureReady(key, loadBitmapFn, desc);
	}

	public async loadModelTextureFromBuffer(buffer: ArrayBuffer, identifier: ModelTextureIdentifier, desc: TextureParams = {}): Promise<TextureKey> {
		const key = this.makeModelBufferKey(identifier);
		return this.loadAndCacheTexture(key, () => Platform.instance.textureLoader.fromBuffer('', buffer), desc);
	}

	public async fetchModelTextureFromUri(uri: string, _identifier: ModelTextureIdentifier, desc: TextureParams = {}, buffer?: ArrayBuffer): Promise<TextureKey> {
		const key = this.makeKey(uri, desc);
		return this.loadAndCacheTexture(key, () => Platform.instance.textureLoader.fromBuffer(uri, buffer), desc);
	}

	public getImage(key: ImageKey): TextureSource | undefined {
		const imgEntry = this.imageCache.get(key);
		return imgEntry ? imgEntry.bitmap : undefined;
	}

	public getTexture(key: TextureKey): TextureHandle | undefined {
		const entry = this.gpuCache.get(key);
		return entry ? entry.handle : undefined;
	}
	public getTextureByUri(uri: string, desc: TextureParams = {}): TextureHandle | undefined {
		return this.getTexture(this.makeKey(uri, desc));
	}

	public releaseByUri(uri: string, desc: TextureParams = {}): void {
		this.releaseByKey(this.makeKey(uri, desc));
	}

	public releaseByKey(key: TextureKey): void {
		const e = this.gpuCache.get(key);
		if (!e) return;
		e.refCount--;
		if (e.refCount <= 0) {
			// Let the barrier dispose the real handle
			this.textureBarrier.release(key, (h) => { if (this.backend) this.backend.destroyTexture(h); });
			// Dispose manager-owned fallback if still present (barrier never saw it)
			if (e.ownedFallback && e.handle && this.backend) this.backend.destroyTexture(e.handle);
			this.gpuCache.delete(key);
		}
	}

	public clear(): void {
		// Dispose any manager-owned fallbacks that never entered the barrier
		for (const [_, entry] of this.gpuCache) {
			if (entry.ownedFallback && entry.handle && this.backend) this.backend.destroyTexture(entry.handle);
		}
		this.gpuCache.clear();
		// Dispose everything the barrier owns
		this.textureBarrier.clear((h) => { if (this.backend) this.backend.destroyTexture(h); });
		this.imageCache.clear();
	}

	public dispose(): void {
		this.clear();
		Registry.instance.deregister(this, false);
	}
}
