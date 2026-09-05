import {
	gxGpuDisplayModeScreenWidth,
	gxGpuVerticalVisibleLines,
} from '../../machine/ts/machine/devices/gx/gpu_display';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { TickCompletion } from '../../machine/ts/machine/scheduler/frame';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

export type RenderPresentationMode = 'partial' | 'completed';

type RenderPresentation = {
	mode: RenderPresentationMode;
	commitFrame: boolean;
};

export class RenderPresentationState {
	private pendingPresentation = false;
	private restoredPresentationPending = false;
	private presentationMode: RenderPresentationMode = 'completed';
	private presentationCommitFrame = false;
	private readonly presentationScratch: RenderPresentation = {
		mode: 'completed',
		commitFrame: false,
	};
	private readonly tickCompletionScratch: TickCompletion = {
		sequence: 0,
		remaining: 0,
		visualCommitted: true,
	};
	private pcrtcScanoutRevision = 0;

	public get pending(): boolean {
		return this.pendingPresentation;
	}

	private presentFrame(
		presenter: VideoPresenter,
		runtime: Runtime,
		currentTimeMs: number,
		hostDeltaMs: number,
		mode: RenderPresentationMode,
		commitFrame: boolean,
	): void {
		const output = runtime.machine.gxGpu.readDeviceOutput();
		const width = output.pcrtcScanout.outputWidth;
		const height = output.pcrtcScanout.outputHeight;
		const displayConfigurationChanged = this.pcrtcScanoutRevision !== output.pcrtcScanout.revision;
		this.pcrtcScanoutRevision = output.pcrtcScanout.revision;
		if (displayConfigurationChanged && output.pcrtcScanout.outputActive) {
			presenter.setRenderTargetSize(width, height);
		}
		presenter.configurePresentation(mode, commitFrame);
		presenter.present(output, currentTimeMs / 1000, hostDeltaMs / 1000);
		if (commitFrame) {
			runtime.machine.gxGpu.retirePresentedCommands();
		}
	}

	private markPresentation(mode: RenderPresentationMode, commitFrame: boolean): void {
		this.pendingPresentation = true;
		this.presentationMode = mode;
		this.presentationCommitFrame = commitFrame;
	}

	public requestHeldPresentation(): void {
		if (!this.pendingPresentation) {
			this.markPresentation('completed', false);
		}
	}

	public requestRestoredPresentation(): void {
		this.restoredPresentationPending = true;
		this.pcrtcScanoutRevision = 0;
		this.markPresentation('completed', true);
	}

	private consumePresentation(out: RenderPresentation): boolean {
		if (!this.pendingPresentation) {
			return false;
		}
		out.mode = this.presentationMode;
		out.commitFrame = this.presentationCommitFrame;
		this.restoredPresentationPending = false;
		this.clearPresentation();
		return true;
	}

	public clearPresentation(): void {
		this.pendingPresentation = this.restoredPresentationPending;
		this.presentationMode = 'completed';
		this.presentationCommitFrame = this.restoredPresentationPending;
	}

	public reset(presenter: VideoPresenter, runtime: Runtime): void {
		this.restoredPresentationPending = false;
		this.clearPresentation();
		this.pcrtcScanoutRevision = 0;
		const output = runtime.machine.gxGpu.readDeviceOutput();
		presenter.setRenderTargetSize(
			gxGpuDisplayModeScreenWidth(output.displayModeWord),
			gxGpuVerticalVisibleLines(
				output.verticalDisplayRangeWord,
				output.displayModeWord,
			),
		);
	}

	public syncAfterRuntimeUpdate(runtime: Runtime, previousTickSequence: number): void {
		let tickVisualCommitted = runtime.frameScheduler.lastTickVisualFrameCommitted;
		while (runtime.frameScheduler.consumeTickCompletion(this.tickCompletionScratch)) {
			if (this.tickCompletionScratch.visualCommitted) {
				tickVisualCommitted = true;
			}
		}
		if (runtime.frameScheduler.lastTickSequence !== previousTickSequence) {
			this.markPresentation('completed', tickVisualCommitted);
		} else if (runtime.isDrawPending) {
			this.markPresentation('partial', false);
		}
	}

	public presentPausedFrame(
		presenter: VideoPresenter,
		runtime: Runtime,
		currentTimeMs: number,
		hostDeltaMs: number,
	): void {
		runtime.frameScheduler.clearQueuedTime();
		this.clearPresentation();
		this.presentFrame(presenter, runtime, currentTimeMs, hostDeltaMs, 'completed', false);
	}

	public presentPending(
		presenter: VideoPresenter,
		runtime: Runtime,
		currentTimeMs: number,
		hostDeltaMs: number,
	): boolean {
		if (!this.consumePresentation(this.presentationScratch)) {
			return false;
		}
		this.presentFrame(
			presenter,
			runtime,
			currentTimeMs,
			hostDeltaMs,
			this.presentationScratch.mode,
			this.presentationScratch.commitFrame,
		);
		return true;
	}
}
