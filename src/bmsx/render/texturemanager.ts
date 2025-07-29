import { Identifier, RegisterablePersistent } from '../core/game';
import { Registry } from '../core/registry';

export async function hashURI(uri: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(uri);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function bufferToImage(buffer: ArrayBuffer): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const blob = new Blob([buffer]);
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

export class TextureManager implements RegisterablePersistent {
    get registrypersistent(): true { return true; }
    public get id(): Identifier { return 'texmanager'; }

    private cache: Map<string, { imageData: HTMLImageElement; refCount: number }> = new Map();

    constructor() { Registry.instance.register(this); }

    public async loadImage(uri: string, buffer?: ArrayBuffer): Promise<HTMLImageElement> {
        const key = await hashURI(uri);
        const cached = this.cache.get(key);
        if (cached) {
            cached.refCount++;
            return cached.imageData;
        }
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
        const img = await bufferToImage(dataBuffer);
        this.cache.set(key, { imageData: img, refCount: 1 });
        return img;
    }

    public async releaseImage(uri: string): Promise<void> {
        const key = await hashURI(uri);
        const cached = this.cache.get(key);
        if (cached) {
            cached.refCount--;
            if (cached.refCount <= 0) this.cache.delete(key);
        }
    }

    public dispose(): void {
        this.cache.clear();
        Registry.instance.deregister(this);
    }
}
