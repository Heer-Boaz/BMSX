//  sRGB Handling in the TypeScript WebGL Backend
// 1. TextureParams type
// interfaces.ts — TextureParams has an optional srgb?: boolean field:

// export interface TextureParams {
//     size?: vec2;
//     wrapS?: number;
//     wrapT?: number;
//     minFilter?: number;
//     magFilter?: number;
//     srgb?: boolean;
// }
// 2. WebGL Backend — createTexture() (main path)
// backend.ts — sRGB is the default. When desc.srgb is undefined (not provided), srgb !== false evaluates to true, so SRGB8_ALPHA8 is used:

// createTexture(src, desc): WebGLTexture {
//     const srgb = desc.srgb !== false;                              // L53 — default = true
//     const internalFormat = srgb ? this.gl.SRGB8_ALPHA8 : this.gl.RGBA8;  // L54
//     ...
//     this.texInfo.set(tex, { w: source.width, h: source.height, srgb });   // L66
// }
// 3. WebGL Backend — updateTexture()
// backend.ts — Preserves the original sRGB flag from texInfo. Falls back to srgb: true if info is missing:

// const srgb = info ? info.srgb : true;                            // L84
// const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;        // L85
// 4. WebGL Backend — resizeTexture()
// backend.ts — Preserves original flag, falls back to desc.srgb !== false:

// const srgb = info ? info.srgb : _desc.srgb !== false;            // L113
// const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;        // L114
// 5. WebGL Backend — createSolidTexture2D() — NOT sRGB
// backend.ts — Uses raw gl.RGBA (not SRGB8_ALPHA8) and explicitly marks srgb: false:

// gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
// ...
// this.texInfo.set(tex, { w: width, h: height, srgb: false });     // L183
// 6. WebGL Backend — createColorTexture() — NOT sRGB
// backend.ts — Used by the render graph for FBO color attachments. Defaults to gl.RGBA8, explicitly srgb: false:

// const internal = (desc.format === undefined ? gl.RGBA8 : desc.format) as GLenum;
// ...
// this.texInfo.set(tex, { w: desc.width, h: desc.height, srgb: false });  // L284
// 7. WebGL Backend — Cubemaps — NOT sRGB
// backend.ts — createCubemapFromSources, createSolidCubemap, createCubemapEmpty all use raw gl.RGBA as internal format, never SRGB8_ALPHA8. No sRGB tracking for cubemaps.

// 8. gl_resources.ts — Legacy helpers
// gl_resources.ts — glCreateTexture() always uses SRGB8_ALPHA8 (hardcoded, no option):

// gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);  // L99
// gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, size.x, size.y, 0, ...);          // L103
// gl_resources.ts — glCreateTextureFromImage() respects the srgb field, defaulting to SRGB8_ALPHA8:

// gl.texImage2D(gl.TEXTURE_2D, 0, desc.srgb === false ? gl.RGBA8 : gl.SRGB8_ALPHA8, ...);  // L168
// 9. WebGPU Backend — consistent behavior
// backend.ts — Same default logic:

// const format = _desc.srgb === false ? 'rgba8unorm' : 'rgba8unorm-srgb';              // L44, L100
// 10. Textpage & Framebuffer Textures — How They're Created
// Textpage textures (primary, secondary, engine) and framebuffer texture are all created via TextureManager.createTextureFromPixelsSync() at texture_manager.ts, which calls backend.createTexture(source, desc). The callers in vdp.ts pass no desc (empty {}):

// handle = $.texmanager.createTextureFromPixelsSync(textureKey, this.vramSeedPixel, 1, 1);  // L2153
// // desc defaults to {} — so srgb is undefined
// Since desc.srgb is undefined, srgb !== false is true → textpage and framebuffer textures are created as SRGB8_ALPHA8.

// They are later resized via resizeTextureForKey(), which calls resizeTexture() on the backend — this preserves the stored srgb flag from texInfo (which will be true from initial creation).

// Summary Table
// Texture Type	Internal Format	sRGB?
// Normal textures (createTexture with no srgb field)	SRGB8_ALPHA8	Yes (default)
// Textpage textures (primary/secondary/engine)	SRGB8_ALPHA8	Yes (no srgb passed → default)
// Framebuffer render texture	SRGB8_ALPHA8	Yes (no srgb passed → default)
// Solid color textures (createSolidTexture2D)	RGBA	No
// Render graph color targets (createColorTexture)	RGBA8	No
// Cubemaps (all variants)	RGBA	No
// Shadow maps	DEPTH_COMPONENT16	N/A
// glCreateTexture (legacy helper)	SRGB8_ALPHA8	Yes (hardcoded)

import { AssetBarrier } from '../core/assetbarrier';
import { GateGroup, taskGate } from '../core/taskgate';
import { clamp01 } from '../common/clamp';
import { color_arr, GLTFModel, Index2GpuTexture, type RomImgAsset, type TextureSource } from '../rompack/format';
import { GPUBackend, TextureHandle, TextureParams } from './backend/interfaces';

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
	barrier?: AssetBarrier<TextureHandle>;
}

export class TextureManager {
	static _instance: TextureManager;
	static get instance(): TextureManager { return this._instance; } // constructed elsewhere

	private imageCache = new Map<ImageKey, ImageCacheEntry>(); // currently used only for future dedupe
	private gpuCache = new Map<TextureKey, GPUCacheEntry>();
	private textureBarrier: AssetBarrier<TextureHandle>;
	private readonly destroyTextureHandle = (handle: TextureHandle): void => {
		this.backend.destroyTexture(handle);
	};

	constructor(private backend: GPUBackend, private defaultGroup: GateGroup = taskGate.group('texture:default')) {
		this.textureBarrier = new AssetBarrier<TextureHandle>(this.defaultGroup);
		TextureManager._instance = this;
	}
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
		const backend = this.backend;

		// Fast path or reserve to avoid race
		const gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }
		this.gpuCache.set(key, { handle: undefined, refCount: 1, barrier: this.textureBarrier }); // reserve entry before awaiting

		const handle = await this.textureBarrier.acquire(
			key,
				async () => {
					const bmp = await loadBitmapFn() as TextureSource;
					const h = backend.createTexture(bmp, desc);
					if ('close' in bmp) (bmp as { close: () => void }).close();
					return h;
				},
					{
						category: 'texture',
						block_render: false,
						tag: `tex:${key}`,
						disposer: this.destroyTextureHandle,
						warnIfLongerMs: 1000,
					}
				);

		// Entry may have been released while loading
		const entry = this.gpuCache.get(key);
		if (!entry) { this.destroyTextureHandle(handle); return key; }
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

	// helper: reserve a fallback cubemap entry that we own
	private reserveFallbackCubemap(key: string, desc: TextureParams, fallbackColor: color_arr): void {
		const fallback = this.backend.createSolidCubemap(1, fallbackColor, desc);
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
				acquireFn,
				{
					category: 'texture',
					block_render: !!assetBarrier, // external barrier implies blocking caller wants it visible
					tag: tag ?? `cubemap:${key}`,
					disposer: this.destroyTextureHandle,
					warnIfLongerMs: 1000,
				}
			).then((real) => {
			const entry = this.gpuCache.get(key);
			if (!entry) { this.destroyTextureHandle(real); return; }
			const old = entry.handle;
			entry.handle = real;
			if (old && entry.ownedFallback) this.destroyTextureHandle(old);
			entry.ownedFallback = false;
		}).catch((err) => {
			console.error(`Cubemap acquire failed for key=${key}`, err);
		});
	}

	public acquireCubemap(options: {
		name: string,
		streamed?: boolean;
		delay_ms?: number;
		assetBarrier?: AssetBarrier<TextureHandle>,
		// loaders and face ids may be null intentionally (some faces left unset)
		faceLoaders: readonly (Promise<TextureSource>)[],
		faceIdsForKey: readonly (string)[],
		desc: TextureParams,
		fallbackColor: color_arr,
	}): TextureKey {
		if (!this.backend) throw new Error('TextureManager backend not set');
		const { name, faceIdsForKey, desc, fallbackColor, assetBarrier, faceLoaders, delay_ms } = options;

		const key = this.makeCubemapKey(name, faceIdsForKey, desc);

		const gpu = this.gpuCache.get(key);
		if (gpu) { gpu.refCount++; return key; }

		this.reserveFallbackCubemap(key, desc, fallbackColor);
		const entry = this.gpuCache.get(key);
		if (entry) {
			entry.barrier = assetBarrier ?? this.textureBarrier;
		}

		const streamed = options.streamed ?? false;

			if (!streamed) {
					this.launchCubemapReplacement(key, async () => {
						if (delay_ms) {
							await new Promise<void>((resolve) => {
								setTimeout(resolve, delay_ms);
							});
						}

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
						if (delay_ms) {
							await new Promise<void>((resolve) => {
								setTimeout(resolve, delay_ms);
							});
						}

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
									this.backend.uploadCubemapFace(cubemap, idx, img);
								});
							} else {
									return this.createSolid(size, fallbackColor).then(img => {
										this.backend.uploadCubemapFace(cubemap, idx, img);
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
		const count = meshModel.imageBuffers ? meshModel.imageBuffers.length : meshModel.imageURIs ? meshModel.imageURIs.length : 0;
		if (count === 0) return gpuTextures;

		for (let i = 0; i < count; i++) {
			if (meshModel.imageBuffers) {
				const buf = meshModel.imageBuffers[i];
				const key = this.makeModelBufferKey({ modelName: meshModel.name, modelImageIndex: i });
				await this.ensureTextureReady(key, this.fromBuffer.bind(this, key, buf), {});
				gpuTextures[i] = key;
			} else if (meshModel.imageURIs) {
				const uri = meshModel.imageURIs[i];
				if (!uri) continue;
				const key = this.makeKey(uri, {});
				await this.ensureTextureReady(key, this.fromBuffer.bind(this, uri), {});
				gpuTextures[i] = key;
			}
		}
		return gpuTextures;
	}

	public async releaseModelTextures(model: GLTFModel): Promise<void> {
		const count = model.imageBuffers ? model.imageBuffers.length : model.imageURIs ? model.imageURIs.length : 0;
		for (let i = 0; i < count; i++) {
			const key = model.imageBuffers
				? this.makeModelBufferKey({ modelName: model.name, modelImageIndex: i })
				: this.makeKey(model.imageURIs![i], {});
			this.releaseByKey(key);
		}
	}

	public async loadTextureFromPixels(keyBase: string, pixels: Uint8Array, width: number, height: number, desc: TextureParams = {}): Promise<TextureHandle> {
		const key = this.makeKey(keyBase, desc);
		const source: TextureSource = { width, height, data: pixels };
		await this.ensureTextureReady(key, async () => source, desc);
		return this.getTexture(key);
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

	public async updateTexturesForAsset(asset: RomImgAsset, pixels: Uint8Array, width: number, height: number): Promise<void> {
		await this.updateTexturesForKey(asset.resid, pixels, width, height);
	}

	public async updateTexturesForKey(keyBase: string, pixels: Uint8Array, width: number, height: number): Promise<void> {
		if (!this.backend) throw new Error('TextureManager backend not set');
		if (width <= 0 || height <= 0) return;
		const prefix = `${keyBase}|`;
		const keys: TextureKey[] = [];
		for (const key of this.gpuCache.keys()) {
			if (key.startsWith(prefix)) {
				keys.push(key);
			}
		}
		if (keys.length === 0) {
			return;
		}
		const source: TextureSource = { width, height, data: pixels };
		for (let i = 0; i < keys.length; i += 1) {
			const entry = this.gpuCache.get(keys[i]);
			if (!entry || !entry.handle) {
				continue;
			}
			this.backend.updateTexture(entry.handle, source);
		}
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

	private async createSolid(size: number, color: color_arr): Promise<TextureSource> {
		const [r, g, b, a] = color;
		const toUint8 = (v: number) => (v <= 1 ? Math.round(v * 255) : Math.round(v));
		const alpha = a <= 1 ? a : clamp01(a / 255);
		const cssColor = `rgba(${toUint8(r)}, ${toUint8(g)}, ${toUint8(b)}, ${alpha})`;
		const dimension = Math.max(1, size);

		// Prefer OffscreenCanvas when available (works in workers and main thread)
		if (typeof OffscreenCanvas !== 'undefined') {
			const oc = new OffscreenCanvas(dimension, dimension);
			const ctx = oc.getContext('2d');
			if (ctx) {
				ctx.fillStyle = cssColor;
				ctx.fillRect(0, 0, dimension, dimension);
				return createImageBitmap(oc);
			}
		}

		// Fallback to HTMLCanvasElement
		if (typeof document === 'undefined') throw new Error('No canvas available to create solid ImageBitmap');
		const canvas = document.createElement('canvas');
		canvas.width = dimension;
		canvas.height = dimension;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = cssColor;
		ctx.fillRect(0, 0, dimension, dimension);
		return createImageBitmap(canvas, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
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
