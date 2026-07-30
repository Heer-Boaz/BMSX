import type {
	SoftwareFrameOutput,
	VideoOutput,
} from '../../../machine/ts/render/video_output';

export interface HeadlessPresentedFrame {
	frameIndex: number;
	width: number;
	height: number;
}

type HeadlessPresentedFrameListener = (frame: HeadlessPresentedFrame) => void;

export class HeadlessVideoOutput implements VideoOutput, SoftwareFrameOutput {
	private readonly displayBounds: { width: number; height: number; left: number; top: number; };
	private readonly presentedFrameListeners: HeadlessPresentedFrameListener[] = [];
	private readonly presentedFrame = { frameIndex: 0, width: 0, height: 0 };
	private presentedPixels: Uint8Array = new Uint8Array(0);
	private presentedFrameCount = 0;

	public constructor(width: number, height: number) {
		this.displayBounds = { width, height, left: 0, top: 0 };
	}

	public setDisplaySize(width: number, height: number): void {
		this.displayBounds.width = width;
		this.displayBounds.height = height;
	}

	public measureDisplay(): { width: number; height: number; left: number; top: number; } {
		return this.displayBounds;
	}

	public presentSoftwareFrame(pixels: Uint8Array, width: number, height: number): void {
		this.presentedPixels = pixels;
		const frame = this.presentedFrame;
		frame.frameIndex = this.presentedFrameCount;
		frame.width = width;
		frame.height = height;
		this.presentedFrameCount += 1;
		for (let index = this.presentedFrameListeners.length - 1; index >= 0; index -= 1) {
			this.presentedFrameListeners[index](frame);
		}
	}

	public borrowPresentedPixels(): Uint8Array {
		return this.presentedPixels;
	}

	public addPresentedFrameListener(listener: HeadlessPresentedFrameListener): void {
		this.presentedFrameListeners.push(listener);
	}

	public removePresentedFrameListener(listener: HeadlessPresentedFrameListener): void {
		const index = this.presentedFrameListeners.indexOf(listener);
		this.presentedFrameListeners.splice(index, 1);
	}

	public get latestPresentedFrame(): HeadlessPresentedFrame | null {
		return this.presentedFrameCount === 0 ? null : this.presentedFrame;
	}
}
