import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PNG } from 'pngjs';

import { taskGate } from '../../../src/bmsx/core/taskgate';
import { HeadlessGameViewHost, type HeadlessPresentedFrame } from '../../../src/bmsx/render/headless/headless_view';

export interface ScheduledHeadlessCapture {
	dueTimeMs: number;
	description: string;
	source: string;
}

interface PendingHeadlessCapture {
	deadlineMs: number;
	description: string;
	source: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
	const expectedByteLength = width * height * 4;
	if (pixels.byteLength !== expectedByteLength) {
		throw new Error(`[headless:capture] Pixel byte length mismatch (${pixels.byteLength} != ${expectedByteLength}).`);
	}
	const png = new PNG({ width, height });
	png.data = Buffer.from(pixels);
	return PNG.sync.write(png);
}

export function deriveHeadlessCaptureOutputDir(sourcePath: string): string {
	return path.join(path.dirname(path.resolve(sourcePath)), 'screenshots');
}

export class HeadlessCaptureCoordinator {
	private readonly gate = taskGate.group('headless:capture');
	private readonly pending: PendingHeadlessCapture[] = [];
	private readonly capturedFrames = new Set<number>();
	private readonly writeFailures: unknown[] = [];
	private readonly frameSubscription;
	private lastPresentedFrame: HeadlessPresentedFrame | null = null;

	constructor(
		private readonly host: HeadlessGameViewHost,
		public readonly outputDir: string,
		private readonly logger: (message: string) => void,
		private readonly nowMs: () => number,
	) {
		this.lastPresentedFrame = host.getPresentedFrameSnapshot();
		this.frameSubscription = host.addPresentedFrameListener(this.handlePresentedFrame);
	}

	public schedule(capture: ScheduledHeadlessCapture): void {
		this.pending.push({
			deadlineMs: this.nowMs() + capture.dueTimeMs,
			description: capture.description,
			source: capture.source,
		});
	}

	public canCaptureNow(): boolean {
		const frame = this.lastPresentedFrame;
		return !!frame && !this.capturedFrames.has(frame.frameIndex);
	}

	public captureNow(description: string, source: string): void {
		if (!this.canCaptureNow()) {
			return;
		}
		const frame = this.lastPresentedFrame!;
		this.captureFrame(frame, {
			deadlineMs: this.nowMs(),
			description,
			source,
		});
	}

	public async flushWrites(drainPendingCaptures = false): Promise<void> {
		if (drainPendingCaptures && this.pending.length > 0) {
			this.capturePendingFromLatestFrame();
		}
		while ((drainPendingCaptures && this.pending.length > 0) || !this.gate.ready) {
			if (drainPendingCaptures && this.pending.length > 0) {
				this.capturePendingFromLatestFrame();
			}
			await sleep(1);
		}
		if (this.writeFailures.length > 0) {
			throw this.writeFailures[0];
		}
	}

	public dispose(): void {
		this.frameSubscription.unsubscribe();
	}

	private handlePresentedFrame = (frame: HeadlessPresentedFrame): void => {
		this.lastPresentedFrame = frame;
		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.pending.length; readIndex += 1) {
			const pending = this.pending[readIndex]!;
			if (this.shouldCapture(pending, frame)) {
				this.captureFrame(frame, pending);
				continue;
			}
			this.pending[writeIndex] = pending;
			writeIndex += 1;
		}
		this.pending.length = writeIndex;
	};

	private capturePendingFromLatestFrame(): void {
		const frame = this.lastPresentedFrame;
		if (!frame) {
			throw new Error('[headless:capture] Cannot flush pending captures before any frame was presented.');
		}
		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.pending.length; readIndex += 1) {
			const pending = this.pending[readIndex]!;
			if (this.nowMs() >= pending.deadlineMs) {
				this.captureFrame(frame, pending);
				continue;
			}
			this.pending[writeIndex] = pending;
			writeIndex += 1;
		}
		this.pending.length = writeIndex;
	}

	private shouldCapture(capture: PendingHeadlessCapture): boolean {
		return this.nowMs() >= capture.deadlineMs;
	}

	private captureFrame(frame: HeadlessPresentedFrame, capture: PendingHeadlessCapture): void {
		if (this.capturedFrames.has(frame.frameIndex)) {
			return;
		}
		this.capturedFrames.add(frame.frameIndex);
		const pixels = this.host.copyPresentedFramePixels();
		const filename = this.buildFilename(frame.frameIndex);
		const outputPath = path.join(this.outputDir, filename);
		const writePromise = this.gate.trackFn(async () => {
			await fs.mkdir(this.outputDir, { recursive: true });
			await fs.writeFile(outputPath, encodePng(frame.width, frame.height, pixels));
		}, {
			blocking: true,
			category: 'screenshot',
			tag: filename,
		});
		void writePromise.catch((error: unknown) => {
			this.writeFailures.push(error);
			console.error(`[headless:capture] Failed to write ${outputPath}:`, error);
		});
	}

	private buildFilename(frameIndex: number): string {
		const paddedFrame = String(frameIndex).padStart(5, '0');
		return `frame_${paddedFrame}.png`;
	}
}
