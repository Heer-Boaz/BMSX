import { AssetBarrier } from '../core/assetbarrier';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { color_arr, GLTFModel, Identifier, Index2GpuTexture, RegisterablePersistent, type RomImgAsset, type TextureSource } from '../rompack/rompack';
import { GPUBackend, TextureHandle, TextureParams } from './backend/pipeline_interfaces';
import { $ } from '../core/game';
import { generateAtlasName } from './gameview';

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
	private makeCubemapKey(name: string, faceIds: readonly (string)[], desc: TextureParams): TextureKey {
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
				const bmp = await loadBitmapFn() as TextureSource;
				const h = this.backend!.createTexture(bmp, desc);
				if ('close' in bmp) (bmp as { close: () => void }).close();
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
				const bmp = await loadBitmapFn() as TextureSource;
				const real = this.backend!.createTexture(bmp, desc);
				if ('close' in bmp) (bmp as { close: () => void }).close();
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
		faceLoaders: readonly (Promise<TextureSource>)[],
		faceIdsForKey: readonly (string)[],
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
					const firstImg = await (faceLoaders[firstProvidedIndex]) as TextureSource;
					if (firstImg.width !== firstImg.height) {
						throw new Error(`[TextureManager] Cubemap first face not square: ${firstImg.width}x${firstImg.height}`);
					}
					targetSize = Math.max(1, firstImg.width, firstImg.height);
				}

				// Build array of promises for all faces, substituting missing faces with solid bitmaps of targetSize
				const promises: Promise<TextureSource>[] = faceLoaders.map(p => p != null ? (p as Promise<TextureSource>) : this.createSolid(targetSize, fallbackColor));

				const faces = await Promise.all(promises) as
					[TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource];
				for (let i = 0; i < 6; i++) {
					const f = faces[i];
					if (f.width !== f.height) {
						throw new Error(`[TextureManager] Cubemap face ${i} not square: ${f.width}x${f.height}`);
					}
					if (f.width !== targetSize || f.height !== targetSize) {
						throw new Error(`[TextureManager] Cubemap face ${i} size mismatch. Expected ${targetSize}x${targetSize}, got ${f.width}x${f.height}`);
					}
				}
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
					if (firstImg.width !== firstImg.height) {
						throw new Error(`[TextureManager] Cubemap first face not square: ${firstImg.width}x${firstImg.height}`);
					}
					size = Math.max(1, firstImg.width, firstImg.height);
				}

				const cubemap = this.backend!.createCubemapEmpty(size, desc);

				// Upload every face: use provided loader or synthesized solid image
				const uploadPromises: Promise<void>[] = faceLoaders.map((p, idx) => {
					if (p != null) {
						return (p as Promise<TextureSource>).then(img => {
							if (img.width !== size || img.height !== size) {
								throw new Error(`[TextureManager] Cubemap face ${idx} size mismatch. Expected ${size}x${size}, got ${img.width}x${img.height}`);
							}
							this.backend!.uploadCubemapFace(cubemap, idx, img);
						});
					} else {
						return this.createSolid(size, fallbackColor).then(img => {
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
		return this.loadAndCacheTexture(key, () => this.fromBuffer(key, buffer), desc);
	}

	public async fetchModelTextureFromUri(uri: string, _identifier: ModelTextureIdentifier, desc: TextureParams = {}, buffer?: ArrayBuffer): Promise<TextureKey> {
		const key = this.makeKey(uri, desc);
		return this.loadAndCacheTexture(key, () => this.fromBuffer(uri, buffer), desc);
	}

	public getImage(key: ImageKey): TextureSource {
		const imgEntry = this.imageCache.get(key);
		return imgEntry ? imgEntry.bitmap : undefined;
	}

	async fromBuffer(uri: string, buffer?: ArrayBuffer, options?: { flipY?: boolean; }): Promise<TextureSource> {
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
					imageOrientation: options?.flipY ? 'flipY' : 'none',
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

	private async createSolid(size: number, color: color_arr): Promise<TextureSource> {
		const [r, g, b, a] = color;
		const toUint8 = (v: number) => (v <= 1 ? Math.round(v * 255) : Math.round(v));
		const alpha = a <= 1 ? a : Math.max(0, Math.min(1, a / 255));
		const cssColor = `rgba(${toUint8(r)}, ${toUint8(g)}, ${toUint8(b)}, ${alpha})`;

		// Prefer OffscreenCanvas when available (works in workers and main thread)
		if (typeof OffscreenCanvas !== 'undefined') {
			const oc = new OffscreenCanvas(Math.max(1, size), Math.max(1, size));
			const ctx = oc.getContext('2d');
			if (ctx) {
				ctx.fillStyle = cssColor;
				ctx.fillRect(0, 0, size, size);
				return createImageBitmap(oc);
			}
		}

		// Fallback to HTMLCanvasElement
		const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
		if (!canvas) throw new Error('No canvas available to create solid ImageBitmap');
		canvas.width = Math.max(1, size);
		canvas.height = Math.max(1, size);
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = cssColor;
		ctx.fillRect(0, 0, size, size);
		return createImageBitmap(canvas, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	}

	// load image from RomImgAsset (possibly atlassed); does not cache result
	// uses private _imgbin and _imgbinYFlipped properties to avoid double caching
	// if options.flipY is true, uses or creates _imgbinYFlipped instead of _imgbin
	// if the asset is atlassed, extracts the region from the atlas image
	// returns ImageBitmap or equivalent platform-specific typed objects
	async fromAsset(romImgAsset: RomImgAsset, options?: { flipY?: boolean; }): Promise<TextureSource> {
		let source: ImageBitmap | Promise<ImageBitmap>;
		if (options?.flipY) {
			source = romImgAsset._imgbinYFlipped as ImageBitmap | Promise<ImageBitmap>; // Use the private _imgbinYFlipped property
		} else {
			source = romImgAsset._imgbin as ImageBitmap | Promise<ImageBitmap>; // Use the private _imgbin property
		}
		if (source) return source;

		// If the image was packed into an atlas, extract its region and cache the result in the `_imgbin` property
		const imgmeta = romImgAsset.imgmeta;
		if (!source && imgmeta.atlassed) {
			const atlasKey = generateAtlasName(imgmeta.atlasid ?? 0);
			const atlasAsset = $.rompack.img[atlasKey];
			const atlas = atlasAsset?._imgbin as ImageBitmap;
			if (!atlas) throw new Error(`Texture atlas image not found for atlas ID ${imgmeta.atlasid}`);
			const coords = imgmeta.texcoords;
			if (!coords) throw new Error(`No texture coordinates for atlassed image '${romImgAsset.resid}'`);

			const xs = [coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]];
			const ys = [coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]];
			const minU = Math.min(...xs), maxU = Math.max(...xs);
			const minV = Math.min(...ys), maxV = Math.max(...ys);

			// Convert to pixel coordinates and clamp inside atlas bounds
			const offsetX = Math.floor(minU * atlas.width);
			const offsetY = Math.floor(minV * atlas.height);
			const imgWidth = Math.max(1, Math.min(atlas.width - offsetX, Math.round((maxU - minU) * atlas.width)));
			const imgHeight = Math.max(1, Math.min(atlas.height - offsetY, Math.round((maxV - minV) * atlas.height)));

			if (typeof createImageBitmap !== 'function') {
				throw new Error('[TextureManager] Atlas extraction requires browser createImageBitmap support.');
			}
			source = createImageBitmap(atlas, offsetX, offsetY, imgWidth, imgHeight, {
				imageOrientation: options?.flipY ? 'flipY' : 'none',
				premultiplyAlpha: 'none',
				colorSpaceConversion: 'none',
			});
		}

		if (!source) throw new Error(`Image asset '${romImgAsset.resid}' has no image data`);
		return source;
	}

	public getTexture(key: TextureKey): TextureHandle {
		const entry = this.gpuCache.get(key);
		return entry ? entry.handle : undefined;
	}

	public getTextureByUri(uri: string, desc: TextureParams = {}): TextureHandle {
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
