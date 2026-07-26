import { machineManager } from '../machine/ts/core/machine_manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type { TickCompletion } from '../machine/ts/machine/scheduler/frame';
import * as workbenchMode from '../ide/workbench/mode';
import { commitGxGpuViewSnapshot } from '../machine/ts/render/gx/view_snapshot';
import type { RuntimeIdeState } from '../ide/runtime/state';

export type RenderPresentationMode = 'partial' | 'completed';

type RenderPresentation = {
	mode: RenderPresentationMode;
	commitFrame: boolean;
};

export class RenderPresentationState {
	public constructor(private readonly ide: RuntimeIdeState) {
	}

	private pendingPresentation = false;
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

	private presentFrame(runtime: Runtime, hostDeltaMs: number, mode: RenderPresentationMode, commitFrame: boolean): void {
		machineManager.deltatime = hostDeltaMs;
		const view = machineManager.view;
		const output = runtime.machine.gxGpu.readDeviceOutput();
		const width = output.pcrtcScanout.outputWidth;
		const height = output.pcrtcScanout.outputHeight;
		const displayConfigurationChanged = view.gxGpuPcrtcScanoutRevision !== output.pcrtcScanout.revision;
		commitGxGpuViewSnapshot(view, output);
		if (displayConfigurationChanged && output.pcrtcScanout.outputActive) {
			view.setRenderTargetSize(width, height);
		}
		view.configurePresentation(mode, commitFrame);
		machineManager.sndmaster.finishFrame();
		machineManager.view.drawgame();
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

	private consumePresentation(runtime: Runtime, out: RenderPresentation): boolean {
		if (!this.pendingPresentation) {
			return false;
		}
		const overlayActive = this.ide.overlayRenderer.active;
		out.mode = this.presentationMode;
		out.commitFrame = overlayActive ? false : this.presentationCommitFrame;
		workbenchMode.tickIDEDraw(this.ide, runtime);
		this.clearPresentation();
		return true;
	}

	public clearPresentation(): void {
		this.pendingPresentation = false;
		this.presentationMode = 'completed';
		this.presentationCommitFrame = false;
	}

	public runOverlay(runtime: Runtime): void {
		this.clearPresentation();
		if (runtime.frameLoop.frameActive) {
			runtime.frameLoop.abandonFrameState();
		}
		runtime.frameScheduler.clearQueuedTime();
		workbenchMode.tickIDE(this.ide, runtime);
		this.markPresentation('completed', false);
	}

	public syncAfterRuntimeUpdate(runtime: Runtime, previousTickSequence: number): void {
		let tickVisualCommitted = runtime.frameScheduler.lastTickVisualFrameCommitted;
		while (runtime.frameScheduler.consumeTickCompletion(this.tickCompletionScratch)) {
			if (this.tickCompletionScratch.visualCommitted) {
				tickVisualCommitted = true;
			}
		}
		if (this.ide.overlayRenderer.active) {
			runtime.frameScheduler.clearQueuedTime();
			this.markPresentation('completed', false);
		} else if (runtime.frameScheduler.lastTickSequence !== previousTickSequence) {
			this.markPresentation('completed', tickVisualCommitted);
		} else if (runtime.isDrawPending) {
			this.markPresentation('partial', false);
		}
	}

	public presentPausedFrame(runtime: Runtime, hostDeltaMs: number): void {
		if (this.ide.overlayRenderer.active) {
			this.runOverlay(runtime);
			this.consumePresentation(runtime, this.presentationScratch);
			this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
			return;
		}
		runtime.frameScheduler.clearQueuedTime();
		this.clearPresentation();
		this.presentFrame(runtime, hostDeltaMs, 'completed', false);
	}

	public presentPending(runtime: Runtime, hostDeltaMs: number): boolean {
		if (!this.consumePresentation(runtime, this.presentationScratch)) {
			return false;
		}
		this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
		return true;
	}

	public presentErrorOverlay(runtime: Runtime, hostDeltaMs: number): void {
		if (!this.ide.overlayRenderer.active) {
			return;
		}
		this.runOverlay(runtime);
		this.consumePresentation(runtime, this.presentationScratch);
		this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
	}
}
