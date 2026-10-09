import { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import type { PublishedGameFrame } from './presentation_state';

/** A view's retained completed image and its matching physical position, never a framebuffer borrow. */
export class FrameBitmap {
	public bitmap: HostBitmap | undefined;
	public readonly published: PublishedGameFrame = { presentationSequence: undefined, cycles: 0, videoTick: 0 };

	public publish(pixels: Uint8Array, width: number, height: number, frame: PublishedGameFrame): void {
		if (this.bitmap === undefined) this.bitmap = new HostBitmap({ width, height, pixels: new Uint8Array(pixels) });
		else this.bitmap.update(pixels, width, height);
		this.published.presentationSequence = frame.presentationSequence;
		this.published.cycles = frame.cycles;
		this.published.videoTick = frame.videoTick;
	}

	public dispose(): void {
		this.bitmap?.dispose();
		this.bitmap = undefined;
		this.published.presentationSequence = undefined;
	}
}
