import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Clipboard } from '../../common/clipboard';
import type { HostControlCapture, HostControlRequest } from '../../common/control/protocol';
import { RemoteInput } from '../../common/input/remote';
import type { HeadlessGPUBackend, HeadlessPresentedFrame } from '../../../machine/ts/render/headless/backend';
import { encodeScreenshotPng } from '../headless/screenshot';

/** Observes host/presentation boundaries, never CPU or editor internals. */
export class HostControlSession {
	private hostFrame = 0;
	private frameWait: { target: number; resolve(): void; reject(error: Error): void } | undefined;
	private captureWait: { resolve(result: HostControlCapture): void; reject(error: unknown): void } | undefined;

	public constructor(
		private readonly input: RemoteInput,
		private readonly backend: HeadlessGPUBackend,
		private readonly captureDirectory: string,
		private readonly clipboard: Clipboard | undefined,
	) {
		backend.addPresentedFrameListener(this.onPresented);
	}

	public async execute(request: HostControlRequest): Promise<unknown> {
		switch (request.execute) {
			case 'input':
				this.input.apply(request.events);
				await this.waitFrames(1);
				return { hostFrame: this.hostFrame };
			case 'wait':
				if (!(request.frames >= 1 && request.frames <= Number.MAX_SAFE_INTEGER && request.frames % 1 === 0)) {
					throw new Error('wait.frames must be a positive host-frame count.');
				}
				await this.waitFrames(request.frames);
				return { hostFrame: this.hostFrame };
			case 'capture':
				return new Promise<HostControlCapture>((resolve, reject) => {
					this.captureWait = { resolve, reject };
				});
			case 'clipboard-set':
				if (!this.clipboard) throw new Error('This host has no clipboard.');
				await this.clipboard.writeText(request.text);
				return {};
			case 'clipboard-get':
				if (!this.clipboard) throw new Error('This host has no clipboard.');
				return { text: this.clipboard.text };
			case 'quit':
				return {};
			default:
				throw new Error('Unknown host-control command.');
		}
	}

	private waitFrames(count: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.frameWait = { target: this.hostFrame + count, resolve, reject };
		});
	}

	public afterFrame(): void {
		this.hostFrame += 1;
		if (this.frameWait && this.hostFrame >= this.frameWait.target) {
			const wait = this.frameWait;
			this.frameWait = undefined;
			wait.resolve();
		}
	}

	private readonly onPresented = (frame: HeadlessPresentedFrame): void => {
		const wait = this.captureWait;
		if (!wait) return;
		this.captureWait = undefined;
		// Encode while the presentation buffer is borrowed, before another frame can reuse it.
		const png = encodeScreenshotPng(frame.width, frame.height, this.backend.borrowPresentedPixels());
		const result: HostControlCapture = {
			presentationFrame: frame.frameIndex, width: frame.width, height: frame.height,
			path: path.join(this.captureDirectory, `frame_${frame.frameIndex}.png`),
		};
		void fs.writeFile(result.path, png).then(() => wait.resolve(result), wait.reject);
	};

	public disconnect(): void {
		this.input.release();
		const error = new Error('Host controller disconnected.');
		this.frameWait?.reject(error);
		this.frameWait = undefined;
		this.captureWait?.reject(error);
		this.captureWait = undefined;
	}

	public dispose(): void {
		this.disconnect();
		this.backend.removePresentedFrameListener(this.onPresented);
	}
}
