import type { RgbaImage } from '../image';
import type { RenderRectBounds } from '../shared/submissions';

/** Immutable host pixels. The presenting view, not the guest asset table, owns their lifetime. */
export class HostBitmap {
	private readonly release = new Set<() => void>();
	public constructor(public readonly image: RgbaImage) {}
	public onDispose(listener: () => void): () => void {
		this.release.add(listener);
		return () => this.release.delete(listener);
	}
	public dispose(): void {
		for (const listener of this.release) listener();
		this.release.clear();
	}
}

export type HostBitmapRenderSubmission = { bitmap: HostBitmap; area: RenderRectBounds };

/** One upload per bitmap/backend, with explicit release on view eviction and backend teardown. */
export class HostBitmapTextures<T> {
	private readonly textures = new Map<HostBitmap, { texture: T; unbind: () => void }>();
	public constructor(private readonly create: (image: RgbaImage) => T, private readonly destroy: (texture: T) => void) {}
	public get(bitmap: HostBitmap): T {
		let entry = this.textures.get(bitmap);
		if (entry === undefined) {
			const texture = this.create(bitmap.image);
			entry = { texture, unbind: bitmap.onDispose(() => { this.destroy(texture); this.textures.delete(bitmap); }) };
			this.textures.set(bitmap, entry);
		}
		return entry.texture;
	}
	public dispose(): void {
		for (const { texture, unbind } of this.textures.values()) { unbind(); this.destroy(texture); }
		this.textures.clear();
	}
}
