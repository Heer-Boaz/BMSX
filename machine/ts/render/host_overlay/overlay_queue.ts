import type { Host2DKind, Host2DRef } from './commands';

export type HostOverlayFrame = {
	logicalWidth: number;
	logicalHeight: number;
	renderWidth: number;
	renderHeight: number;
	commandKinds: readonly Host2DKind[];
	commandRefs: readonly Host2DRef[];
	commandCount: number;
};

export type HostMenuFrame = {
	commandKinds: readonly Host2DKind[];
	commandRefs: readonly Host2DRef[];
	commandCount: number;
};

export class HostOverlayQueue {
	private pendingFrame: HostOverlayFrame;
	private hasPendingFrame = false;
	private pendingMenuFrame: HostMenuFrame;
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

	public publishHostMenuFrame(frame: HostMenuFrame): void {
		this.pendingMenuFrame = frame;
		this.hasPendingMenuFrame = true;
	}

	public hasPendingHostMenuFrame(): boolean {
		return this.hasPendingMenuFrame;
	}

	public consumeHostMenuFrame(): HostMenuFrame {
		this.hasPendingMenuFrame = false;
		return this.pendingMenuFrame;
	}

	public clearHostMenuFrame(): void {
		this.hasPendingMenuFrame = false;
	}
}
