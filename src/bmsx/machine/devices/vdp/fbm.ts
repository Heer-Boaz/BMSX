import { createVdpDirtySpans, type VdpDirtySpan, type VdpFrameBufferPresentation, type VdpSurfaceUploadSlot } from './device_output';

export const VDP_FBM_STATE_PAGE_WRITABLE = 0;
export const VDP_FBM_STATE_PAGE_PENDING_PRESENT = 1;
export const VDP_FBM_STATE_PAGE_PRESENTED = 2;
export const VDP_FBM_STATE_READBACK_REQUESTED = 3;

export type VdpFbmState =
	| typeof VDP_FBM_STATE_PAGE_WRITABLE
	| typeof VDP_FBM_STATE_PAGE_PENDING_PRESENT
	| typeof VDP_FBM_STATE_PAGE_PRESENTED
	| typeof VDP_FBM_STATE_READBACK_REQUESTED;

type MutableVdpFrameBufferPresentation = {
	-readonly [Key in keyof VdpFrameBufferPresentation]: VdpFrameBufferPresentation[Key];
};

export class VdpFbmUnit {
	private _width = 0;
	private _height = 0;
	private _state: VdpFbmState = VDP_FBM_STATE_PAGE_WRITABLE;
	private displayFrameBufferCpuReadback: Uint8Array = new Uint8Array(0);
	private presentationCount = 0;
	private presentationRequiresFullSync = false;
	private presentationDirtyRowStart = 0;
	private presentationDirtyRowEnd = 0;
	private presentationDirtySpansByRow: VdpDirtySpan[] = [];
	private readonly presentationOutput: MutableVdpFrameBufferPresentation = {
		presentationCount: 0,
		requiresFullSync: false,
		dirtyRowStart: 0,
		dirtyRowEnd: 0,
		dirtySpansByRow: this.presentationDirtySpansByRow,
		renderReadback: new Uint8Array(0),
		displayReadback: this.displayFrameBufferCpuReadback,
		width: 0,
		height: 0,
	};

	public get width(): number {
		return this._width;
	}

	public get height(): number {
		return this._height;
	}

	public get state(): VdpFbmState {
		return this._state;
	}

	public get displayReadback(): Uint8Array {
		return this.displayFrameBufferCpuReadback;
	}

	public get hasPendingPresentation(): boolean {
		return this.presentationCount !== 0;
	}

	public configure(width: number, height: number): void {
		this._width = width;
		this._height = height;
		this.displayFrameBufferCpuReadback = new Uint8Array(width * height * 4);
		this.presentationDirtySpansByRow = createVdpDirtySpans(height);
		this.resetPresentation();
	}

	public captureDisplayReadback(): Uint8Array {
		return this.displayFrameBufferCpuReadback.slice(0, this._width * this._height * 4);
	}

	public restoreDisplayReadback(pixels: Uint8Array): void {
		this.displayFrameBufferCpuReadback = pixels.slice();
		for (let row = 0; row < this.presentationDirtySpansByRow.length; row += 1) {
			const span = this.presentationDirtySpansByRow[row]!;
			span.xStart = 0;
			span.xEnd = 0;
		}
		this.resetPresentation();
	}

	public presentPage(renderSlot: VdpSurfaceUploadSlot): void {
		if (this.presentationCount === 0) {
			this.presentationDirtyRowStart = renderSlot.dirtyRowStart;
			this.presentationDirtyRowEnd = renderSlot.dirtyRowEnd;
			for (let row = renderSlot.dirtyRowStart; row < renderSlot.dirtyRowEnd; row += 1) {
				const source = renderSlot.dirtySpansByRow[row]!;
				const target = this.presentationDirtySpansByRow[row]!;
				target.xStart = source.xStart;
				target.xEnd = source.xEnd;
			}
		} else {
			this.presentationRequiresFullSync = true;
		}
		this.presentationCount += 1;
		const displayReadback = this.displayFrameBufferCpuReadback;
		this.displayFrameBufferCpuReadback = renderSlot.cpuReadback;
		renderSlot.cpuReadback = displayReadback;
		this._state = VDP_FBM_STATE_PAGE_PENDING_PRESENT;
	}

	public copyReadbackPixelsFrom(source: Uint8Array, x: number, y: number, width: number, height: number, out: Uint8Array): void {
		this._state = VDP_FBM_STATE_READBACK_REQUESTED;
		const rowBytes = width * 4;
		const stride = this._width * 4;
		for (let row = 0; row < height; row += 1) {
			const srcOffset = (y + row) * stride + x * 4;
			const dstOffset = row * rowBytes;
			out.set(source.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
		}
	}

	public buildPresentation(renderReadback: Uint8Array): VdpFrameBufferPresentation {
		const presentation = this.presentationOutput;
		presentation.presentationCount = this.presentationCount;
		presentation.requiresFullSync = this.presentationRequiresFullSync;
		presentation.dirtyRowStart = this.presentationDirtyRowStart;
		presentation.dirtyRowEnd = this.presentationDirtyRowEnd;
		presentation.dirtySpansByRow = this.presentationDirtySpansByRow;
		presentation.renderReadback = renderReadback;
		presentation.displayReadback = this.displayFrameBufferCpuReadback;
		presentation.width = this._width;
		presentation.height = this._height;
		return presentation;
	}

	public clearPresentation(): void {
		for (let row = this.presentationDirtyRowStart; row < this.presentationDirtyRowEnd; row += 1) {
			const span = this.presentationDirtySpansByRow[row]!;
			span.xStart = 0;
			span.xEnd = 0;
		}
		this.resetPresentation();
		this._state = VDP_FBM_STATE_PAGE_PRESENTED;
	}

	private resetPresentation(): void {
		this.presentationCount = 0;
		this.presentationRequiresFullSync = false;
		this.presentationDirtyRowStart = 0;
		this.presentationDirtyRowEnd = 0;
		this._state = VDP_FBM_STATE_PAGE_WRITABLE;
	}
}
