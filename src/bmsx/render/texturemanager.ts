import { Registry } from '../core/registry';
import { GLTFModel, Identifier, Index2GpuTexture, RegisterablePersistent, Size } from '../rompack/rompack';
import { glCreateTextureFromImage } from './glutils';

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
        return glCreateTextureFromImage(this.gl, img, 2, desc);
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
        if (!this.backend) throw new Error('TextureManager backend not set');

        // Check for existing GPU entry first (fast path for already-loaded textures)
        let gpuCached = this.gpuCache.get(key);
        if (gpuCached) {
            gpuCached.refCount++;
            return key;
        }

        // If no image entry, create a promise for the full process
        let imgEntry = this.imageCache.get(key);
        if (!imgEntry) {
            // Cache a promise for the entire acquire (image + GPU creation)
            const acquirePromise = (async () => {
                const bitmap = await loadBitmapFn();
                // At this point, create GPU texture (no race possible since promise is shared)
                const handle = this.backend!.createTextureFromImage(bitmap, desc);
                this.gpuCache.set(key, { handle, refCount: 1 }); // refCount starts at 1 for the creator
                return bitmap; // Return bitmap if needed, but mainly for awaiting
            })();

            imgEntry = { refCount: 1, promise: acquirePromise };
            this.imageCache.set(key, imgEntry);

            // Await the full promise
            imgEntry.bitmap = await acquirePromise;
            imgEntry.promise = undefined;
        } else {
            imgEntry.refCount++;
            if (imgEntry.promise) {
                // Await the shared full-acquire promise
                await imgEntry.promise.then(b => { imgEntry!.bitmap = b; imgEntry!.promise = undefined; });
            }
            // After await, GPU should exist; increment its refCount
            gpuCached = this.gpuCache.get(key);
            if (gpuCached) {
                gpuCached.refCount++;
            } else {
                // This shouldn't happen with shared promise, but log if paranoid
                console.error(`GPU cache missing after shared acquire for key: ${key}`);
            }
        }

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
        const gpuEntry = this.gpuCache.get(key);
        if (gpuEntry) {
            gpuEntry.refCount--;
            if (gpuEntry.refCount <= 0) {
                if (this.backend) this.backend.destroyTexture(gpuEntry.handle);
                this.gpuCache.delete(key);
                const imgEntry = this.imageCache.get(key);
                if (imgEntry) {
                    imgEntry.refCount--;
                    if (imgEntry.refCount <= 0) this.imageCache.delete(key);
                }
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
