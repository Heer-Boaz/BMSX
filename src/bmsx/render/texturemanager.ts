import { Identifier, RegisterablePersistent } from '../core/game';
import { Registry } from '../core/registry';
import { glCreateTextureFromImage } from './glutils';

export interface TextureIdentifier {
    modelName: string;
    modelImageIndex: number;
}

export interface TextureParams {
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
    public get id(): Identifier { return 'texmanager'; }

    private backend?: GPUBackend;
    private imageCache = new Map<string, ImageCacheEntry>();
    private gpuCache = new Map<string, GPUCacheEntry>();

    constructor(backend?: GPUBackend) {
        this.backend = backend;
        Registry.instance.register(this);
    }

    public setBackend(backend: GPUBackend): void {
        this.backend = backend;
    }

    private makeKey(uri: string, desc: TextureParams): TextureKey {
        const descKey = JSON.stringify(desc);
        return `${uri}|${descKey}`;
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

    public async acquireFromBuffer(buffer: ArrayBuffer, identifier: TextureIdentifier, desc: TextureParams = {}): Promise<TextureKey> {
        if (!this.backend) throw new Error('TextureManager backend not set');
        const key = `${identifier.modelName}:${identifier.modelImageIndex}`;
        const gpuCached = this.gpuCache.get(key);
        if (gpuCached) {
            gpuCached.refCount++;
            return key; // Return existing key without loading again
        }
        let imgEntry = this.imageCache.get(key);
        if (!imgEntry) {
            const promise = this.loadBitmap('', buffer);
            imgEntry = { refCount: 1, promise };
            this.imageCache.set(key, imgEntry);
            imgEntry.bitmap = await promise;
            imgEntry.promise = undefined;
        } else {
            imgEntry.refCount++;
            if (imgEntry.promise) {
                await imgEntry.promise.then(b => { imgEntry!.bitmap = b; imgEntry!.promise = undefined; });
            }
        }
        const handle = this.backend.createTextureFromImage(imgEntry.bitmap!, desc);
        this.gpuCache.set(key, { handle, refCount: 1 });
        return key; // Return the key for the newly created texture
    }

    public async acquireFromUri(uri: string, _identifier: TextureIdentifier, desc: TextureParams = {}, buffer?: ArrayBuffer): Promise<TextureKey> {
        if (!this.backend) throw new Error('TextureManager backend not set');
        const key = this.makeKey(uri, desc);

        const gpuCached = this.gpuCache.get(key);
        if (gpuCached) {
            gpuCached.refCount++;
            return key; // Return existing key without loading again
        }

        let imgEntry = this.imageCache.get(key);
        if (!imgEntry) {
            const promise = this.loadBitmap(uri, buffer);
            imgEntry = { refCount: 1, promise };
            this.imageCache.set(key, imgEntry);
            imgEntry.bitmap = await promise;
            imgEntry.promise = undefined;
        } else {
            imgEntry.refCount++;
            if (imgEntry.promise) {
                await imgEntry.promise.then(b => { imgEntry!.bitmap = b; imgEntry!.promise = undefined; });
            }
        }

        const handle = this.backend.createTextureFromImage(imgEntry.bitmap!, desc);
        this.gpuCache.set(key, { handle, refCount: 1 });
        return key; // Return the key for the newly created texture
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

    public dispose(): void {
        for (const entry of this.gpuCache.values()) {
            if (this.backend) this.backend.destroyTexture(entry.handle);
        }
        this.gpuCache.clear();
        this.imageCache.clear();
        Registry.instance.deregister(this);
    }
}
