import { AssetBarrier } from '../core/assetbarrier';
import { Registry } from '../core/registry';
import { GLTFModel, Identifier, Index2GpuTexture, RegisterablePersistent, Size } from '../rompack/rompack';
import { glCreateTextureFromImage } from './glutils';
import { mainRenderGate } from './rendergate';

export const TEXTMANAGER_ID = 'texmgr';

export interface TextureIdentifier {
    modelName: string;
    modelImageIndex: number;
}

export interface TextureParams {
    size?: Size;
    wrapS?: number;
    wrapT?: number;
    minFilter?: number;
    magFilter?: number;
}

export type TextureHandle = unknown;
export type TextureKey = string;
export type ImageKey = string;

export interface GPUBackend {
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): TextureHandle;
    destroyTexture(handle: TextureHandle): void;
}

export class WebGLBackend implements GPUBackend {
    constructor(private gl: WebGL2RenderingContext) { }

    createTextureFromImage(img: ImageBitmap, desc: TextureParams): WebGLTexture {
        return glCreateTextureFromImage(this.gl, img, 3, desc);
    }

    destroyTexture(handle: WebGLTexture): void {
        this.gl.deleteTexture(handle);
    }
}

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
    handle: TextureHandle;
    refCount: number;
}

export class TextureManager implements RegisterablePersistent {
    get registrypersistent(): true { return true; }
    public get id(): Identifier { return 'texmgr'; }

    private backend?: GPUBackend;
    private imageCache = new Map<ImageKey, ImageCacheEntry>();
    private gpuCache = new Map<TextureKey, GPUCacheEntry>();
    private textureBarrier = new AssetBarrier<WebGLTexture>(mainRenderGate);

    constructor(backend?: GPUBackend) {
        this.backend = backend;
        Registry.instance.register(this);
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
            const key = await this.loadTextureFromBuffer(buf, { modelName: meshModel.name, modelImageIndex: i });
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

    private makeBufferKey(identifier: TextureIdentifier): TextureKey {
        return `buf:${identifier.modelName}:${identifier.modelImageIndex}`;
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
        key: string,
        loadBitmapFn: () => Promise<ImageBitmap>,
        desc: TextureParams,
        fallbackHandle: WebGLTexture,         // bv. 1×1 checker / flat color
    ): TextureKey {
        if (!this.backend) throw new Error('TextureManager backend not set');

        // Fast path: GPU al aanwezig
        let gpu = this.gpuCache.get(key);
        if (gpu) { gpu.refCount++; return key; }

        // Plaats fallback meteen (non-blocking)
        this.gpuCache.set(key, { handle: fallbackHandle, refCount: 1 });

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
                this.backend!.destroyTexture(realHandle);
                return;
            }
            // Vervang fallback door echte handle (disposen van fallback is optioneel)
            if (entry.handle !== realHandle) {
                const old = entry.handle;
                entry.handle = realHandle;
                // Als je fallback een gedeelde checker is: NIET deleten.
                // Alleen deleten als het een dedicated temp-tex was:
                // this.backend!.destroyTexture(old);
            }
        }).catch(err => {
            console.error(`Texture acquire failed for key=${key}`, err);
        });

        return key;
    }

    public async loadTextureFromBuffer(buffer: ArrayBuffer, identifier: TextureIdentifier, desc: TextureParams = {}): Promise<TextureKey> {
        const key = this.makeBufferKey(identifier);
        return this.loadAndCacheTexture(key, () => this.loadBitmap('', buffer), desc);
    }

    public async fetchTextureFromUri(uri: string, _identifier: TextureIdentifier, desc: TextureParams = {}, buffer?: ArrayBuffer): Promise<TextureKey> {
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
                this.textureBarrier.invalidate(key, (h) => this.backend?.destroyTexture(h));
                // Verwijder GPU-handle
                if (this.backend) this.backend.destroyTexture(gpuEntry.handle);
                this.gpuCache.delete(key);
            }
        }
    }

    public clear(): void {
        for (const entry of this.gpuCache.values()) {
            if (this.backend) this.backend.destroyTexture(entry.handle);
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
