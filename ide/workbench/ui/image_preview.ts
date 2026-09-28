import type { RgbaImage } from '../../../machine/ts/render/image';
import type { ImageDecoder } from '../../../hosts/common/image';
import { HostBitmap } from '../../../machine/ts/render/host_overlay/bitmap';
import { api } from '../../runtime/overlay_api';

export type ImagePreview = { bitmap?: HostBitmap; error?: string; epoch: number; retired: boolean };

/** Viewport-owned decoded images. Encoded message URLs remain in the conversation. */
export class ImagePreviewCache {
	private readonly images = new Map<string, ImagePreview>();
	private epoch = 0;
	public constructor(private readonly decode: ImageDecoder) {}
	public beginFrame(): void { this.epoch++; }
	public use(url: string, decoded?: RgbaImage): ImagePreview {
		let entry = this.images.get(url);
		if (entry === undefined) {
			const pending: ImagePreview = { epoch: this.epoch, retired: false };
			entry = pending; this.images.set(url, entry);
			if (decoded !== undefined) pending.bitmap = new HostBitmap(decoded);
			else void this.decode(url, 512, 512).then(image => {
				if (!pending.retired) pending.bitmap = new HostBitmap(image);
			}, error => { if (!pending.retired) pending.error = String(error); });
		}
		entry.epoch = this.epoch;
		return entry;
	}
	public endFrame(): void {
		for (const [url, entry] of this.images) if (entry.epoch !== this.epoch) {
			entry.retired = true; entry.bitmap?.dispose(); this.images.delete(url);
		}
	}
	public dispose(): void {
		for (const entry of this.images.values()) { entry.retired = true; entry.bitmap?.dispose(); }
		this.images.clear();
	}
}

/** Contain, never stretch or crop a screenshot. Submission retains only the bitmap and quad. */
export function drawImagePreview(bitmap: HostBitmap, left: number, top: number, right: number, bottom: number): void {
	const { width, height } = bitmap.image;
	const scale = Math.min((right - left) / width, (bottom - top) / height);
	const w = width * scale, h = height * scale;
	const x = left + (right - left - w) / 2, y = top + (bottom - top - h) / 2;
	api.drawBitmap(bitmap, x, y, x + w, y + h);
}
