import { AssetBarrier } from '../core/assetbarrier';
import { $ } from '../core/game';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { color_arr, GLTFModel, Identifier, Index2GpuTexture, RegisterablePersistent } from '../rompack/rompack';
import { GPUBackend, TextureHandle, TextureParams } from './backend/pipeline_interfaces';

export const TEXTMANAGER_ID = 'texmgr';
export type TextureIdentifier = string;

export interface ModelTextureIdentifier {
    modelName: string;
    modelImageIndex: number;
}

// TextureParams & TextureHandle now sourced from gpu_types.ts to break circular dependencies.
export type TextureKey = string;
export type ImageKey = string;

// GPUBackend implementation lives in backend/webgl_backend.ts (legacy gpu_backend shim removed).

export async function hashURI(uri: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(uri);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bufferToImageBitmap(buffer: ArrayBuffer): Promise<ImageBitmap> {
    const blob = new Blob([buffer]);
    return await createImageBitmap(blob);
}

interface ImageCacheEntry {
    bitmap?: ImageBitmap;
    promise?: Promise<ImageBitmap>;
    refCount: number;
}

interface GPUCacheEntry {
    handle?: TextureHandle;
    refCount: number;
}

export class TextureManager implements RegisterablePersistent {
    get registrypersistent(): true { return true; }
    public get id(): Identifier { return 'texmgr'; }

    static _instance: TextureManager;

    static get instance(): TextureManager {
        return this._instance; // Note: don't automatically create the instance! The instance requires initialization.
    }

    private imageCache = new Map<ImageKey, ImageCacheEntry>();
    private gpuCache = new Map<TextureKey, GPUCacheEntry>();
    private textureBarrier: AssetBarrier<WebGLTexture>;

    constructor(private backend?: GPUBackend, private defaultGroup: GateGroup = taskGate.group('texture:default')) {
        this.textureBarrier = new AssetBarrier<WebGLTexture>(this.defaultGroup);
        TextureManager._instance = this;
        this.bind();
    }

    public bind(): void {
        Registry.instance.register(this);
    }

    public unbind(): void {
        Registry.instance.deregister(this);
    }

    public setBackend(backend: GPUBackend): void {
        this.backend = backend;
    }

    public async fetchModelTextures(meshModel: GLTFModel): Promise<Index2GpuTexture> {
        if (!meshModel.materials || meshModel.materials.length === 0) return {};
        if (!meshModel.imageURIs && !meshModel.imageBuffers) return {};
        const count = meshModel.imageBuffers ? meshModel.imageBuffers.length : (meshModel.imageURIs?.length ?? 0);
        const gpuTextures: Index2GpuTexture = {};
        for (let i = 0; i < count; i++) {
            const buf = meshModel.imageBuffers ? meshModel.imageBuffers[i] : undefined;
            const key = await this.loadModelTextureFromBuffer(buf, { modelName: meshModel.name, modelImageIndex: i });
            gpuTextures[i] = key;
        }
        return gpuTextures;
    }

    public async releaseModelTextures(model: GLTFModel): Promise<void> {
        const textureManager = $.texmanager;
        if (model.imageURIs) {
            for (const uri of model.imageURIs) {
                if (uri) textureManager.releaseByUri(uri, {});
            }
        }
    }

    private makeKey(uri: string, desc: TextureParams): TextureKey {
        const descKey = JSON.stringify(desc);
        return `${uri}|${descKey}`;
    }

    private makeModelBufferKey(identifier: ModelTextureIdentifier): TextureKey {
        return `buf:${identifier.modelName}:${identifier.modelImageIndex}`;
    }

    private makeCubemapKey(name: string, faceIds: readonly string[], desc: TextureParams): TextureKey {
        const descKey = JSON.stringify(desc);
        return `cubemap:${name}|faces:${faceIds.join(',')}|${descKey}`;
    }

    private async loadBitmap(uri: string, buffer?: ArrayBuffer): Promise<ImageBitmap> {
        let dataBuffer: ArrayBuffer;
        if (buffer) {
            dataBuffer = buffer;
        } else if (uri.startsWith('data:')) {
            const base64 = uri.split(',')[1];
            dataBuffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
        } else {
            const resp = await fetch(uri);
            dataBuffer = await resp.arrayBuffer();
        }
        return bufferToImageBitmap(dataBuffer);
    }

    private async loadAndCacheTexture(key: string, loadBitmapFn: () => Promise<ImageBitmap>, desc: TextureParams): Promise<TextureKey> {
        return this.ensureTextureReady(key, loadBitmapFn, desc);
    }

    /**
     * Blocking/legacy: wacht tot de echte GPU-texture klaar is en zet die in de cache.
     * Dit behoudt het oude semantische gedrag van loadAndCacheTexture(...).
     */
    private async ensureTextureReady(
        key: string,
        loadBitmapFn: () => Promise<ImageBitmap>,
        desc: TextureParams
    ): Promise<TextureKey> {
        if (!this.backend) throw new Error('TextureManager backend not set');

        // Fast path: GPU al aanwezig
        let gpu = this.gpuCache.get(key);
        if (gpu) { gpu.refCount++; return key; }

        // Start en wacht: barrier met blocking:false (render blijft doorlopen),
        // maar deze call resolved pas als GPU-handle bestaat.
        const handle = await this.textureBarrier.acquire(
            key,
            async () => {
                const bmp = await loadBitmapFn();
                return this.backend!.createTextureFromImage(bmp, desc);
            },
            {
                category: 'texture',
                block_render: false, // non-blocking voor renderer; deze methode blockt alleen de caller
                tag: `tex:${key}`,
                disposer: (h) => this.backend!.destroyTexture(h)
            }
        );

        // Zet in gpuCache nadat handle er is
        this.gpuCache.set(key, { handle, refCount: 1 });
        return key;
    }

    /**
     * Non-blocking acquire: registreert (of hergebruikt) een texture key,
     * plaatst een fallback handle direct in de gpuCache en start async upload.
     * Callers mogen meteen renderen met de fallback; de echte GPU-texture
     * vervangt ‘m zodra de promise resolve’t.
     */
    public acquireTexture(
        key: TextureKey,
        loadBitmapFn: () => Promise<ImageBitmap>,
        desc: TextureParams = {},
        fallbackHandle?: WebGLTexture,         // bv. 1×1 checker / flat color (optional)
    ): TextureKey {
        if (!this.backend) throw new Error('TextureManager backend not set');

        // Fast path: GPU al aanwezig
        let gpu = this.gpuCache.get(key);
        if (gpu) { gpu.refCount++; return key; }

        // Plaats fallback meteen (non-blocking) or reserve empty entry
        if (fallbackHandle !== undefined) {
            this.gpuCache.set(key, { handle: fallbackHandle, refCount: 1 });
        } else {
            // reserve an entry so refcounts/releases work even without immediate handle
            this.gpuCache.set(key, { handle: undefined, refCount: 1 });
        }

        // Start async load via barrier (non-blocking; geen await)
        void this.textureBarrier.acquire(
            key,
            async () => {
                const bmp = await loadBitmapFn();
                const real = this.backend!.createTextureFromImage(bmp, desc);
                return real;
            },
            {
                category: 'texture',
                block_render: false,
                tag: `tex:${key}`,
                disposer: (h) => this.backend!.destroyTexture(h),
            }
        ).then((realHandle) => {
            // Als de entry nog bestaat en niemand released heeft:
            const entry = this.gpuCache.get(key);
            if (!entry) { // niemand houdt nog vast → dispose nieuwe
                if (this.backend && realHandle) this.backend.destroyTexture(realHandle);
                return;
            }
            // Vervang fallback of lege entry door echte handle (disposen van fallback is optioneel)
            if (entry.handle !== realHandle) {
                const old = entry.handle;
                entry.handle = realHandle;
                // Destroy old only when present
                if (old && this.backend) this.backend.destroyTexture(old);
            }
        }).catch(err => {
            console.error(`Texture acquire failed for key=${key}`, err);
        });

        return key;
    }

    // helper: reserve a fallback cubemap entry and return the asset barrier to use
    private reserveFallbackCubemap(key: string, desc: TextureParams, fallbackColor: color_arr, assetBarrier?: AssetBarrier<WebGLTexture>): AssetBarrier<WebGLTexture> {
        // place fallback immediately in cache (non-blocking)
        const fallback = this.backend!.createSolidCubemap(1, fallbackColor, desc);
        this.gpuCache.set(key, { handle: fallback, refCount: 1 });
        return assetBarrier ?? this.textureBarrier;
    }

    // central helper to start an async replace of the fallback cubemap with a real one
    private launchCubemapReplacement(
        key: string,
        acquireFn: () => Promise<TextureHandle>,
        assetBarrier?: AssetBarrier<WebGLTexture>,
        tag?: string
    ): void {
        const barrier = assetBarrier ?? this.textureBarrier;
        void barrier.acquire(
            key,
            async () => {
                return await acquireFn();
            },
            {
                category: 'texture',
                block_render: assetBarrier ? true : false,
                tag: tag ?? `cubemap:${key}`,
                disposer: (h) => this.backend!.destroyTexture(h),
                warnIfLongerMs: 1000
            }
        ).then((real) => {
            const entry = this.gpuCache.get(key);
            if (!entry) { if (this.backend && real) this.backend.destroyTexture(real); return; }
            const old = entry.handle;
            entry.handle = real;
            if (old && this.backend) this.backend!.destroyTexture(old);
        }).catch(err => console.error(`Cubemap acquire failed for key=${key}`, err));
    }

    public acquireCubemap(
        options?: {
            name: string,
            streamed?: boolean;
            delayMs?: number;
            assetBarrier?: AssetBarrier<WebGLTexture>,
            faceLoaders: readonly [Promise<ImageBitmap>, Promise<ImageBitmap>, Promise<ImageBitmap>,
                Promise<ImageBitmap>, Promise<ImageBitmap>, Promise<ImageBitmap>],
            faceIdsForKey: readonly [string, string, string, string, string, string],
            desc: TextureParams,
            fallbackColor: color_arr,
        }
    ): TextureKey {
        if (!this.backend) throw new Error('TextureManager backend not set');
        const { name, faceIdsForKey, desc, fallbackColor, assetBarrier, faceLoaders, delayMs } = options;

        const key = this.makeCubemapKey(name, faceIdsForKey, desc);

        // Fast path
        let gpu = this.gpuCache.get(key);
        if (gpu) { gpu.refCount++; return key; }

        // reserve fallback
        this.reserveFallbackCubemap(key, desc, fallbackColor, assetBarrier);

        const streamed = options?.streamed ?? false;

        if (!streamed) {
            // atomic: wait for all faces, then create cubemap in one wo
            this.launchCubemapReplacement(key, async () => {
                if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                const faces = await Promise.all(faceLoaders.map(fn => fn)) as
                    [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap];
                return this.backend!.createCubemapFromImages(faces, desc);
            }, assetBarrier, `cubemap:${name}`);
        } else {
            // streamed: create empty cubemap and upload faces as they arrive
            this.launchCubemapReplacement(key, async () => {
                if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
                const first = await faceLoaders[0];
                const size = first.width; // assume square
                const cubemap = this.backend!.createCubemapEmpty(size, desc);
                // upload first face immediately
                this.backend!.uploadCubemapFace(cubemap, 0, first);
                // upload remaining faces in parallel as they resolve
                await Promise.all(faceLoaders.slice(1).map((fn, idx) =>
                    fn.then(img => this.backend!.uploadCubemapFace(cubemap, idx + 1, img))
                ));
                return cubemap;
            }, assetBarrier, `cubemap:${name}:streamed`);
        }

        return key;
    }

    public async loadModelTextureFromBuffer(buffer: ArrayBuffer, identifier: ModelTextureIdentifier, desc: TextureParams = {}): Promise<TextureKey> {
        const key = this.makeModelBufferKey(identifier);
        return this.loadAndCacheTexture(key, () => this.loadBitmap('', buffer), desc);
    }

    public async fetchModelTextureFromUri(uri: string, _identifier: ModelTextureIdentifier, desc: TextureParams = {}, buffer?: ArrayBuffer): Promise<TextureKey> {
        const key = this.makeKey(uri, desc);
        return this.loadAndCacheTexture(key, () => this.loadBitmap(uri, buffer), desc);
    }

    public getImage(key: ImageKey): ImageBitmap | undefined {
        const imgEntry = this.imageCache.get(key);
        return imgEntry ? imgEntry.bitmap : undefined;
    }

    public getTexture(key: TextureKey): TextureHandle | undefined {
        const gpuEntry = this.gpuCache.get(key);
        return gpuEntry ? gpuEntry.handle : undefined;
    }

    public getTextureByUri(uri: string, desc: TextureParams = {}): TextureHandle | undefined {
        return this.getTexture(this.makeKey(uri, desc));
    }

    public releaseByUri(uri: string, desc: TextureParams = {}): void {
        const key = this.makeKey(uri, desc);

        // refcount omlaag in gpuCache
        const gpuEntry = this.gpuCache.get(key);
        if (gpuEntry) {
            gpuEntry.refCount--;
            if (gpuEntry.refCount <= 0) {
                // Invalideer entry in barrier zodat late promises niet terugschrijven
                this.textureBarrier.invalidate(key, (h) => { if (this.backend && h) this.backend.destroyTexture(h); });
                // Verwijder GPU-handle
                if (this.backend && gpuEntry.handle) this.backend.destroyTexture(gpuEntry.handle);
                this.gpuCache.delete(key);
            }
        }
    }

    public releaseByKey(key: TextureKey): void {
        const gpuEntry = this.gpuCache.get(key);
        if (!gpuEntry) return;
        gpuEntry.refCount--;
        if (gpuEntry.refCount <= 0) {
            this.textureBarrier.invalidate(key, (h) => { if (this.backend && h) this.backend.destroyTexture(h); });
            if (this.backend && gpuEntry.handle) this.backend.destroyTexture(gpuEntry.handle);
            this.gpuCache.delete(key);
        }
    }

    public clear(): void {
        for (const entry of this.gpuCache.values()) {
            if (this.backend && entry.handle) this.backend.destroyTexture(entry.handle);
        }
        this.gpuCache.clear();
        this.imageCache.clear();
    }

    public dispose(): void {
        this.clear();
        // Do not remove this persistent record. The code here is here to ensure that the manager will be disposed if we change the manager to become non-persistent in the future.
        Registry.instance.deregister(this, false);
    }
}
