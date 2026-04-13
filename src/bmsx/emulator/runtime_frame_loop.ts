import { $ } from '../core/engine_core';
import {
	clearBackQueues,
	prepareCompletedRenderQueues,
	prepareHeldRenderQueues,
	prepareOverlayRenderQueues,
	preparePartialRenderQueues,
} from '../render/shared/render_queues';
import type { Runtime } from './runtime';
import type { TickCompletion } from './runtime_machine_scheduler';
import * as runtimeIde from './runtime_ide';

export type RuntimePresentationMode = 'partial' | 'completed';

type RuntimePresentation = {
	mode: RuntimePresentationMode;
	commitFrame: boolean;
};

const MAX_FRAME_DELTA = 250;

export class RuntimeFrameLoopState {
	public currentTimeMs = 0;
	private pendingPresentation = false;
	private presentationMode: RuntimePresentationMode = 'completed';
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
	private readonly runtimePresentationScratch: RuntimePresentation = {
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

	private recordHostFrame(currentTime: number): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		if (this.debugPresentReportAtMs === 0) {
			this.debugPresentReportAtMs = currentTime;
		}
		this.debugPresentHostFrames += 1;
	}

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

	private recordPresentation(mode: RuntimePresentationMode, commitFrame: boolean): void {
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

	private flushPresentDebugReport(currentTime: number, runtime: Runtime): void {
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
			+ `draw_pending=${runtime.isDrawPending ? 1 : 0} active_tick=${runtime.hasActiveTick() ? 1 : 0}`
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

	private presentFrame(runtime: Runtime, hostDeltaMs: number, mode: RuntimePresentationMode, commitFrame = mode === 'completed'): void {
		$.deltatime = hostDeltaMs;
		$.view.configurePresentation(mode, commitFrame);
		this.recordPresentation(mode, commitFrame);
		$.sndmaster.finishFrame();
		$.view.drawgame();
		runtime.scheduleDeferredCartBootPreparation();
	}

	public clearPresentation(): void {
		this.pendingPresentation = false;
		this.presentationMode = 'completed';
		this.presentationCommitFrame = false;
	}

	public reset(): void {
		this.currentTimeMs = 0;
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

	public markPresentation(mode: RuntimePresentationMode, commitFrame: boolean): void {
		this.pendingPresentation = true;
		this.presentationMode = mode;
		this.presentationCommitFrame = commitFrame;
	}

	public runOverlay(runtime: Runtime): void {
		this.clearPresentation();
		if (runtime.currentFrameState !== null) {
			runtime.abandonFrameState();
		}
		runtime.machineScheduler.clearQueuedTime();
		runtimeIde.tickIDE(runtime);
		runtimeIde.tickTerminalMode(runtime);
		this.markPresentation('completed', false);
	}

	public consumePresentation(runtime: Runtime, out: RuntimePresentation): boolean {
		if (!this.pendingPresentation) {
			return false;
		}
		out.mode = this.presentationMode;
		out.commitFrame = runtime.executionOverlayActive ? false : this.presentationCommitFrame;
		if (runtime.executionOverlayActive) {
			clearBackQueues();
		}
		runtime.tickDraw();
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

	private presentPausedFrame(runtime: Runtime, hostDeltaMs: number): void {
		if (runtime.executionOverlayActive) {
			this.runOverlay(runtime);
			this.consumePresentation(runtime, this.runtimePresentationScratch);
			this.presentFrame(runtime, hostDeltaMs, this.runtimePresentationScratch.mode, this.runtimePresentationScratch.commitFrame);
			return;
		}
		runtime.machineScheduler.clearQueuedTime();
		this.clearPresentation();
		prepareHeldRenderQueues();
		this.presentFrame(runtime, hostDeltaMs, 'completed', false);
	}

	private presentPending(runtime: Runtime, hostDeltaMs: number): void {
		if (!this.consumePresentation(runtime, this.runtimePresentationScratch)) {
			return;
		}
		this.presentFrame(runtime, hostDeltaMs, this.runtimePresentationScratch.mode, this.runtimePresentationScratch.commitFrame);
	}

	private presentErrorOverlay(runtime: Runtime, hostDeltaMs: number): void {
		if (!runtime.executionOverlayActive) {
			return;
		}
		this.runOverlay(runtime);
		this.consumePresentation(runtime, this.runtimePresentationScratch);
		this.presentFrame(runtime, hostDeltaMs, this.runtimePresentationScratch.mode, this.runtimePresentationScratch.commitFrame);
	}

	public runHostFrame(runtime: Runtime, currentTime: number, runReady: boolean): void {
		if (!$.running) {
			return;
		}
		let hostDeltaMs = 0;
		try {
			$.input.pollInput();
			this.recordHostFrame(currentTime);
			runtimeIde.tickIdeInput(runtime);
			runtimeIde.tickTerminalInput(runtime);
			hostDeltaMs = Math.min(currentTime - this.currentTimeMs, MAX_FRAME_DELTA);
			this.currentTimeMs = currentTime;

			if ($.paused) {
				this.presentPausedFrame(runtime, hostDeltaMs);
				return;
			}

			this.clearPresentation();
			if (!runReady) {
				if (runtime.executionOverlayActive) {
					this.runOverlay(runtime);
				} else {
					runtime.machineScheduler.clearQueuedTime();
				}
			} else if (runtime.executionOverlayActive) {
				this.runOverlay(runtime);
			} else {
				const previousTickSequence = runtime.lastTickSequence;
				$.deltatime = runtime.timing.frameDurationMs;
				runtime.machineScheduler.run(runtime, hostDeltaMs);
				if (runtime.executionOverlayActive) {
					runtime.machineScheduler.clearQueuedTime();
					this.markPresentation('completed', false);
				} else if (runtime.lastTickSequence !== previousTickSequence) {
					this.markPresentation('completed', runtime.lastTickVisualFrameCommitted);
				} else if (runtime.isDrawPending) {
					this.markPresentation('partial', false);
				}
				while (runtime.machineScheduler.consumeTickCompletion(runtime, this.tickCompletionScratch)) {
					this.recordTickCompletion(this.tickCompletionScratch.visualCommitted, this.tickCompletionScratch.vdpFrameHeld);
				}
			}
			this.presentPending(runtime, hostDeltaMs);
		} catch (error) {
			try {
				runtimeIde.handleLuaError(runtime, error);
				runtime.abandonFrameState();
				this.presentErrorOverlay(runtime, hostDeltaMs);
			} catch {
				console.error(`Error while handling surfaced game error in runtime: ${error}`);
				runtime.abandonFrameState();
			}
		}
		this.flushPresentDebugReport(currentTime, runtime);
	}
}
