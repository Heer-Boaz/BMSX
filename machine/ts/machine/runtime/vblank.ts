import { IRQ_VBLANK } from '../../spec/bmsx/io';
import {
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN,
	GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END,
} from '../devices/gx/gpu_pcrtc';
import type { FrameState } from './frame/state';
import { Runtime } from './runtime';

export class VblankState {
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	private activeTickCompleted = false;

	constructor(private readonly runtime: Runtime) {
	}

	public get tickCompleted(): boolean {
		return this.activeTickCompleted;
	}

	public reset(): void {
		const runtime = this.runtime;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		runtime.machine.inputController.cancelSampleArm();
		runtime.machine.irqController.postLoad();
	}

	public prepareRestore(): void {
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
	}

	public beginTick(): void {
		this.activeTickCompleted = false;
	}

	public abandonTick(): void {
		this.activeTickCompleted = false;
	}

	public handleGpuRuntimeEdge(edge: number): void {
		if (edge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) {
			this.enterVblank();
			return;
		}
		if (edge === GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END) {
			return;
		}
	}

	private enterVblank(): void {
		const runtime = this.runtime;
		this.vblankSequence += 1;
		runtime.machine.gxGpu.presentReadyFrameOnVblankEdge();
		runtime.machine.inputController.onVblankEdge(
			runtime.machine.scheduler.nowCycles,
		);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		if (runtime.frameLoop.frameActive) {
			this.completeTickIfPending(runtime.frameLoop.frameState, this.vblankSequence);
		}
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) return;
		this.activeTickCompleted = true;
		const runtime = this.runtime;
		runtime.frameScheduler.enqueueTickCompletion(frameState);
		this.lastCompletedVblankSequence = vblankSequence;
	}
}
