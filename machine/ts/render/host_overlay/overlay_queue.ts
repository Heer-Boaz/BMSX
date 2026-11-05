import type { Host2DCommandList } from './commands';

/** A complete host frame carries the coordinate system used to author its commands. */
export type HostOverlayFrame = Host2DCommandList & {
	logicalWidth: number;
	logicalHeight: number;
};

export class HostOverlayQueue {
	private pendingFrame: HostOverlayFrame;
	private hasPendingFrame = false;
	private pendingMenuFrame: HostOverlayFrame;
	private hasPendingMenuFrame = false;

	public publishOverlayFrame(frame: HostOverlayFrame): void {
		this.pendingFrame = frame;
		this.hasPendingFrame = true;
	}

	public hasPendingOverlayFrame(): boolean {
		return this.hasPendingFrame;
	}

	public consumeOverlayFrame(): HostOverlayFrame {
		this.hasPendingFrame = false;
		return this.pendingFrame;
	}

	public clearOverlayFrame(): void {
		this.hasPendingFrame = false;
	}

	public publishHostMenuFrame(frame: HostOverlayFrame): void {
		this.pendingMenuFrame = frame;
		this.hasPendingMenuFrame = true;
	}

	public hasPendingHostMenuFrame(): boolean {
		return this.hasPendingMenuFrame;
	}

	public consumeHostMenuFrame(): HostOverlayFrame {
		this.hasPendingMenuFrame = false;
		return this.pendingMenuFrame;
	}

	public clearHostMenuFrame(): void {
		this.hasPendingMenuFrame = false;
	}
}
