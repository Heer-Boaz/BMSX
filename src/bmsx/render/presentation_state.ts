import { consoleCore } from '../core/console';
import type { Runtime } from '../machine/runtime/runtime';
import type { TickCompletion } from '../machine/scheduler/frame';
import * as workbenchMode from '../ide/workbench/mode';
import { commitVdpViewSnapshot } from './vdp/view_snapshot';

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

	constructor(private readonly runtime: Runtime) {
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

	private recordPresentation(mode: RenderPresentationMode, commitFrame: boolean): void {
		if (!Boolean((globalThis as any).__bmsx_debug_presentrate)) {
			return;
		}
		if (consoleCore.paused) {
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

	private resetDebugCounters(reportAtMs: number): void {
		this.debugPresentReportAtMs = reportAtMs;
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

	private presentFrame(hostDeltaMs: number, mode: RenderPresentationMode, commitFrame = mode === 'completed'): void {
		const runtime = this.runtime;
		consoleCore.deltatime = hostDeltaMs;
		runtime.machine.vdp.drainFrameBufferPresentation(consoleCore.view.vdpFrameBufferTextures);
		runtime.machine.vdp.drainSurfaceUploads(consoleCore.view.vdpSlotTextures);
		commitVdpViewSnapshot(consoleCore.view, runtime.machine.vdp.readDeviceOutput());
		consoleCore.view.configurePresentation(mode, commitFrame);
		this.recordPresentation(mode, commitFrame);
		consoleCore.sndmaster.finishFrame();
		consoleCore.view.drawgame();
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

	private consumePresentation(out: RenderPresentation): boolean {
		if (!this.pendingPresentation) {
			return false;
		}
		const runtime = this.runtime;
		const overlayActive = runtime.executionOverlayActive;
		out.mode = this.presentationMode;
		out.commitFrame = overlayActive ? false : this.presentationCommitFrame;
		workbenchMode.tickIDEDraw(runtime);
		workbenchMode.tickTerminalModeDraw(runtime);
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
		this.resetDebugCounters(0);
	}

	public runOverlay(): void {
		const runtime = this.runtime;
		this.clearPresentation();
		if (runtime.frameLoop.currentFrameState !== null) {
			runtime.frameLoop.abandonFrameState();
		}
		runtime.frameScheduler.clearQueuedTime();
		workbenchMode.tickIDE(runtime);
		workbenchMode.tickTerminalMode(runtime);
		this.markPresentation('completed', false);
	}

	public syncAfterRuntimeUpdate(previousTickSequence: number): void {
		const runtime = this.runtime;
		if (runtime.executionOverlayActive) {
			runtime.frameScheduler.clearQueuedTime();
			this.markPresentation('completed', false);
		} else if (runtime.frameScheduler.lastTickSequence !== previousTickSequence) {
			this.markPresentation('completed', runtime.frameScheduler.lastTickVisualFrameCommitted);
		} else if (runtime.isDrawPending || runtime.workbenchFaultState.faultSnapshot !== null) {
			this.markPresentation('partial', false);
		}
		while (runtime.frameScheduler.consumeTickCompletion(this.tickCompletionScratch)) {
			this.recordTickCompletion(this.tickCompletionScratch.visualCommitted, this.tickCompletionScratch.vdpFrameHeld);
		}
	}


	public presentPausedFrame(hostDeltaMs: number): void {
		const runtime = this.runtime;
		if (runtime.executionOverlayActive) {
			this.runOverlay();
			this.consumePresentation(this.presentationScratch);
			this.presentFrame(hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
			return;
		}
		runtime.frameScheduler.clearQueuedTime();
		this.clearPresentation();
		this.presentFrame(hostDeltaMs, 'completed', false);
	}

	public presentPending(hostDeltaMs: number): boolean {
		if (!this.consumePresentation(this.presentationScratch)) {
			return false;
		}
		this.presentFrame(hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
		return true;
	}

	public presentErrorOverlay(hostDeltaMs: number): void {
		const runtime = this.runtime;
		if (!runtime.executionOverlayActive) {
			return;
		}
		this.runOverlay();
		this.consumePresentation(this.presentationScratch);
		this.presentFrame(hostDeltaMs, this.presentationScratch.mode, this.presentationScratch.commitFrame);
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
			+ `draw_pending=${runtime.isDrawPending || runtime.workbenchFaultState.faultSnapshot !== null ? 1 : 0} active_tick=${runtime.frameLoop.currentFrameState !== null ? 1 : 0}`
		);
		this.resetDebugCounters(currentTime);
	}
}
