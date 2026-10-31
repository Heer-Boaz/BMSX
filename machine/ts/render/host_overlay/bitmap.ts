import type { RgbaImage } from '../image';
import type { color } from '../shared/submissions';

/** Owned host pixels. Only this resource publishes updates; views own its lifetime, not guest assets. */
export class HostBitmap {
	private readonly release = new Set<() => void>();
	public revision = 0;
	/** Transfers the image storage to this resource. */
	public constructor(public readonly image: RgbaImage) {}
	/** Publishes borrowed producer pixels without retaining their mutable storage. */
	public update(pixels: Uint8Array, width: number, height: number): void {
		const image = this.image, byteCount = width * height * 4;
		if (image.pixels.length !== byteCount) image.pixels = new Uint8Array(byteCount);
		image.width = width;
		image.height = height;
		image.pixels.set(pixels);
		this.revision += 1;
	}
	public onDispose(listener: () => void): () => void {
		this.release.add(listener);
		return () => this.release.delete(listener);
	}
	public dispose(): void {
		for (const listener of this.release) listener();
		this.release.clear();
	}
}

/** A host-pixel texture on an affine unit square, in logical overlay coordinates. */
export type HostBitmapRenderSubmission = {
	bitmap: HostBitmap;
	originX: number;
	originY: number;
	axisXX: number;
	axisXY: number;
	axisYX: number;
	axisYY: number;
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	color: color;
};

/** Retained backend storage. Held views do not upload; revisions update, dimensions replace storage. */
export class HostBitmapTextures<T> {
	private readonly textures = new Map<HostBitmap, { texture: T; revision: number; width: number; height: number; unbind: () => void }>();
	public constructor(
		private readonly create: (image: RgbaImage) => T,
		private readonly update: (texture: T, image: RgbaImage) => void,
		private readonly destroy: (texture: T) => void,
	) {}
	public get(bitmap: HostBitmap): T {
		let entry = this.textures.get(bitmap);
		const image = bitmap.image;
		if (entry === undefined) {
			entry = {
				texture: this.create(image), revision: bitmap.revision, width: image.width, height: image.height,
				unbind: bitmap.onDispose(() => { this.destroy(entry.texture); this.textures.delete(bitmap); }),
			};
			this.textures.set(bitmap, entry);
		} else if (entry.revision !== bitmap.revision) {
			if (entry.width !== image.width || entry.height !== image.height) {
				this.destroy(entry.texture);
				entry.texture = this.create(image);
				entry.width = image.width;
				entry.height = image.height;
			} else this.update(entry.texture, image);
			entry.revision = bitmap.revision;
		}
		return entry.texture;
	}
	public dispose(): void {
		for (const { texture, unbind } of this.textures.values()) { unbind(); this.destroy(texture); }
		this.textures.clear();
	}
}
