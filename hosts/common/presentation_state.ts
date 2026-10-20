import {
	gxGpuDisplayModeScreenWidth,
	gxGpuVerticalVisibleLines,
} from '../../machine/ts/machine/devices/gx/gpu_display';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { TickCompletion } from '../../machine/ts/machine/scheduler/frame';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { PublishedGameFrame } from './image';

export type RenderPresentationMode = 'partial' | 'completed';

type RenderPresentation = {
	mode: RenderPresentationMode;
	commitFrame: boolean;
};

const enum PresentationIntent { None, Held, Partial, Commit }

export class RenderPresentationState {
	/** Machine position when a completed image was published, not each held UI repaint. */
	public readonly gameFrame: PublishedGameFrame = { presentationSequence: undefined, cycles: 0, videoTick: 0 };
	private presentationIntent = PresentationIntent.None;
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
		return this.presentationIntent !== PresentationIntent.None;
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
			presenter.setScanoutSize(width, height);
		}
		presenter.configurePresentation(mode, commitFrame);
		presenter.present(output, currentTimeMs / 1000, hostDeltaMs / 1000);
		if (commitFrame) {
			this.gameFrame.presentationSequence = presenter.gameFrameSequence;
			this.gameFrame.cycles = runtime.machine.scheduler.currentNowCycles();
			this.gameFrame.videoTick = runtime.frameScheduler.lastTickSequence;
			runtime.machine.gxGpu.retirePresentedCommands();
		}
	}

	private markPresentation(intent: PresentationIntent): void {
		if (intent > this.presentationIntent) this.presentationIntent = intent;
	}

	public requestHeldPresentation(): void {
		this.markPresentation(PresentationIntent.Held);
	}

	public requestRestoredPresentation(): void {
		this.pcrtcScanoutRevision = 0;
		this.markPresentation(PresentationIntent.Commit);
	}

	private consumePresentation(out: RenderPresentation): boolean {
		if (this.presentationIntent === PresentationIntent.None) {
			return false;
		}
		out.mode = this.presentationIntent === PresentationIntent.Partial ? 'partial' : 'completed';
		out.commitFrame = this.presentationIntent === PresentationIntent.Commit;
		this.clearPresentation();
		return true;
	}

	public beginHostFrame(): void {
		if (this.presentationIntent !== PresentationIntent.Commit) this.clearPresentation();
	}

	public clearPresentation(): void {
		this.presentationIntent = PresentationIntent.None;
	}

	public reset(presenter: VideoPresenter, runtime: Runtime): void {
		this.gameFrame.presentationSequence = undefined;
		this.clearPresentation();
		this.pcrtcScanoutRevision = 0;
		const output = runtime.machine.gxGpu.readDeviceOutput();
		presenter.setScanoutSize(
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
			this.markPresentation(tickVisualCommitted ? PresentationIntent.Commit : PresentationIntent.Held);
		} else if (runtime.isDrawPending) {
			this.markPresentation(PresentationIntent.Partial);
		}
	}

	public presentPausedFrame(
		presenter: VideoPresenter,
		runtime: Runtime,
		currentTimeMs: number,
		hostDeltaMs: number,
	): void {
		runtime.frameScheduler.clearQueuedTime();
		if (!this.presentPending(presenter, runtime, currentTimeMs, hostDeltaMs)) {
			this.presentFrame(presenter, runtime, currentTimeMs, hostDeltaMs, 'completed', false);
		}
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
