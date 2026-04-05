import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PNG } from 'pngjs';

import { taskGate } from '../../../src/bmsx/core/taskgate';
import type { PresentedFrameInfo } from '../../../src/bmsx/platform/platform';
import { HeadlessGameViewHost } from '../../../src/bmsx/render/headless/headless_view';

export interface ScheduledHeadlessCapture {
	dueTimeMs: number;
	targetFrame?: number;
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
	private readonly pending: ScheduledHeadlessCapture[] = [];
	private readonly frameCaptureCounts = new Map<number, number>();
	private readonly writeFailures: unknown[] = [];
	private readonly frameSubscription;

	constructor(
		private readonly host: HeadlessGameViewHost,
		public readonly outputDir: string,
		private readonly logger: (message: string) => void,
	) {
		this.frameSubscription = host.addPresentedFrameListener(this.handlePresentedFrame);
	}

	public schedule(capture: ScheduledHeadlessCapture): void {
		this.pending.push(capture);
	}

	public async flushWrites(drainPendingCaptures = false): Promise<void> {
		while ((drainPendingCaptures && this.pending.length > 0) || !this.gate.ready) {
			await sleep(1);
		}
		if (this.writeFailures.length > 0) {
			throw this.writeFailures[0];
		}
	}

	public dispose(): void {
		this.frameSubscription.unsubscribe();
	}

	private handlePresentedFrame = (frame: PresentedFrameInfo): void => {
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

	private shouldCapture(capture: ScheduledHeadlessCapture, frame: PresentedFrameInfo): boolean {
		return frame.timeMs >= capture.dueTimeMs;
	}

	private captureFrame(frame: PresentedFrameInfo, capture: ScheduledHeadlessCapture): void {
		const pixels = this.host.copyPresentedFramePixels();
		const filename = this.buildFilename(frame.frameIndex);
		const outputPath = path.join(this.outputDir, filename);
		this.logger(`[${capture.source}] capture ${capture.description} -> ${outputPath}`);
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
		const nextCount = (this.frameCaptureCounts.get(frameIndex) ?? 0) + 1;
		this.frameCaptureCounts.set(frameIndex, nextCount);
		const paddedFrame = String(frameIndex).padStart(5, '0');
		if (nextCount === 1) {
			return `frame_${paddedFrame}.png`;
		}
		return `frame_${paddedFrame}_${String(nextCount).padStart(2, '0')}.png`;
	}
}
