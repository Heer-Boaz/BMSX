import { $ } from '../core/engine_core';
import {
	clearBackQueues,
	prepareCompletedRenderQueues,
	prepareHeldRenderQueues,
	prepareOverlayRenderQueues,
	preparePartialRenderQueues,
} from './shared/render_queues';
import type { Runtime } from '../machine/runtime/runtime';
import type { TickCompletion } from '../machine/scheduler/frame_scheduler';
import * as runtimeIde from '../ide/runtime/runtime_ide';

export type RenderPresentationMode = 'partial' | 'completed';

type RenderPresentation = {
	mode: RenderPresentationMode;
	commitFrame: boolean;
};

export class RenderPresentationState {
	private pendingPresentation = false;
	private presentationMode: RenderPresentationMode = 'completed';
	private presentationCommitFrame = false;
	private debugPresentReportAtMs = 0;
	private debugPresentHostFrames = 0;
	private debugPresentTickCompleted = 0;
	private debugPresentTickCommitted = 0;
	private debugPresentTickDeferred = 0;
	private debugPresentTickHeld = 0;
	private debugPresentPartialPresents = 0;
	private debugPresentCommitPresents = 0;
	private debugPresentHoldPresents = 0;
	private debugPresentPausedPresents = 0;
	private readonly presentationScratch: RenderPresentation = {
		mode: 'completed',
		commitFrame: false,
	};
	private readonly tickCompletionScratch: TickCompletion = {
		sequence: 0,
		remaining: 0,
		visualCommitted: true,
		vdpFrameCost: 0,
		vdpFrameHeld: false,
	};

	private recordTickCompletion(visualCommitted: boolean, vdpFrameHeld: boolean): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		this.debugPresentTickCompleted += 1;
		if (visualCommitted) {
			this.debugPresentTickCommitted += 1;
		} else {
			this.debugPresentTickDeferred += 1;
		}
		if (vdpFrameHeld) {
			this.debugPresentTickHeld += 1;
		}
	}

	private recordPresentation(mode: RenderPresentationMode, commitFrame: boolean): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		if ($.paused) {
			this.debugPresentPausedPresents += 1;
			return;
		}
		if (mode === 'partial') {
			this.debugPresentPartialPresents += 1;
			return;
		}
		if (commitFrame) {
			this.debugPresentCommitPresents += 1;
			return;
		}
		this.debugPresentHoldPresents += 1;
	}

	private presentFrame(runtime: Runtime, hostDeltaMs: number, mode: RenderPresentationMode, commitFrame = mode === 'completed'): void {
		$.deltatime = hostDeltaMs;
		$.view.configurePresentation(mode, commitFrame);
		this.recordPresentation(mode, commitFrame);
		$.sndmaster.finishFrame();
		$.view.drawgame();
		runtime.cartBoot.scheduleDeferredPreparation(runtime);
	}

	private markPresentation(mode: RenderPresentationMode, commitFrame: boolean): void {
		this.pendingPresentation = true;
		this.presentationMode = mode;
		this.presentationCommitFrame = commitFrame;
	}

	private consumePresentation(runtime: Runtime, out: RenderPresentation): boolean {
		if (!this.pendingPresentation) {
			return false;
		}
		out.mode = this.presentationMode;
		out.commitFrame = runtime.executionOverlayActive ? false : this.presentationCommitFrame;
		if (runtime.executionOverlayActive) {
			clearBackQueues();
		}
		runtimeIde.tickIDEDraw(runtime);
		runtimeIde.tickTerminalModeDraw(runtime);
		if (runtime.executionOverlayActive) {
			prepareOverlayRenderQueues();
		} else if (out.mode === 'completed' && out.commitFrame) {
			prepareCompletedRenderQueues();
		} else if (out.mode === 'completed') {
			prepareHeldRenderQueues();
		} else {
			preparePartialRenderQueues();
		}
		this.clearPresentation();
		return true;
	}

	public beginHostFrame(currentTime: number): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		if (this.debugPresentReportAtMs === 0) {
			this.debugPresentReportAtMs = currentTime;
		}
		this.debugPresentHostFrames += 1;
	}

	public clearPresentation(): void {
		this.pendingPresentation = false;
		this.presentationMode = 'completed';
		this.presentationCommitFrame = false;
	}

	public reset(): void {
		this.clearPresentation();
		this.debugPresentReportAtMs = 0;
		this.debugPresentHostFrames = 0;
		this.debugPresentTickCompleted = 0;
		this.debugPresentTickCommitted = 0;
		this.debugPresentTickDeferred = 0;
		this.debugPresentTickHeld = 0;
		this.debugPresentPartialPresents = 0;
		this.debugPresentCommitPresents = 0;
		this.debugPresentHoldPresents = 0;
		this.debugPresentPausedPresents = 0;
	}

	public runOverlay(runtime: Runtime): void {
		this.clearPresentation();
		if (runtime.frameLoop.currentFrameState !== null) {
			runtime.frameLoop.abandonFrameState(runtime);
		}
		runtime.frameScheduler.clearQueuedTime();
		runtimeIde.tickIDE(runtime);
		runtimeIde.tickTerminalMode(runtime);
		this.markPresentation('completed', false);
	}

	public syncAfterRuntimeUpdate(runtime: Runtime, previousTickSequence: number): void {
		if (runtime.executionOverlayActive) {
			runtime.frameScheduler.clearQueuedTime();
			this.markPresentation('completed', false);
		} else if (runtime.frameScheduler.lastTickSequence !== previousTickSequence) {
			this.markPresentation('completed', runtime.frameScheduler.lastTickVisualFrameCommitted);
		} else if (runtime.isDrawPending) {
			this.markPresentation('partial', false);
		}
		while (runtime.frameScheduler.consumeTickCompletion(this.tickCompletionScratch)) {
			this.recordTickCompletion(this.tickCompletionScratch.visualCommitted, this.tickCompletionScratch.vdpFrameHeld);
		}
	}

	public presentPausedFrame(runtime: Runtime, hostDeltaMs: number): void {
		if (runtime.executionOverlayActive) {
			this.runOverlay(runtime);
			this.consumePresentation(runtime, this.presentationScratch);
			this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
			return;
		}
		runtime.frameScheduler.clearQueuedTime();
		this.clearPresentation();
		prepareHeldRenderQueues();
		this.presentFrame(runtime, hostDeltaMs, 'completed', false);
	}

	public presentPending(runtime: Runtime, hostDeltaMs: number): void {
		if (!this.consumePresentation(runtime, this.presentationScratch)) {
			return;
		}
		this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
	}

	public presentErrorOverlay(runtime: Runtime, hostDeltaMs: number): void {
		if (!runtime.executionOverlayActive) {
			return;
		}
		this.runOverlay(runtime);
		this.consumePresentation(runtime, this.presentationScratch);
		this.presentFrame(runtime, hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
	}

	public flushDebugReport(currentTime: number, runtime: Runtime): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		if (this.debugPresentReportAtMs === 0) {
			this.debugPresentReportAtMs = currentTime;
			return;
		}
		const elapsedMs = currentTime - this.debugPresentReportAtMs;
		if (elapsedMs < 1000) {
			return;
		}
		const scale = 1000 / elapsedMs;
		const hostFps = this.debugPresentHostFrames * scale;
		console.warn(
			`[BMSX][present] host_frames=${this.debugPresentHostFrames} host_fps=${hostFps.toFixed(2)} ufps=${runtime.timing.ufps.toFixed(2)} `
			+ `tick_completed=${this.debugPresentTickCompleted} tick_committed=${this.debugPresentTickCommitted} `
			+ `tick_deferred=${this.debugPresentTickDeferred} tick_held=${this.debugPresentTickHeld} `
			+ `present_partial=${this.debugPresentPartialPresents} present_commit=${this.debugPresentCommitPresents} `
			+ `present_hold=${this.debugPresentHoldPresents} present_paused=${this.debugPresentPausedPresents} `
				+ `draw_pending=${runtime.isDrawPending ? 1 : 0} active_tick=${runtime.frameLoop.currentFrameState !== null ? 1 : 0}`
			);
		this.debugPresentReportAtMs = currentTime;
		this.debugPresentHostFrames = 0;
		this.debugPresentTickCompleted = 0;
		this.debugPresentTickCommitted = 0;
		this.debugPresentTickDeferred = 0;
		this.debugPresentTickHeld = 0;
		this.debugPresentPartialPresents = 0;
		this.debugPresentCommitPresents = 0;
		this.debugPresentHoldPresents = 0;
		this.debugPresentPausedPresents = 0;
	}
}
