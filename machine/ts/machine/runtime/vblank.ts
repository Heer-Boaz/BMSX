import { IRQ_VBLANK } from '../bus/io';
import type { FrameState } from './frame/state';
import { Runtime } from './runtime';
import { refreshDeviceTimings } from './timing/config';
import { TIMER_KIND_VBLANK_BEGIN, TIMER_KIND_VBLANK_END } from '../scheduler/device';

export type RuntimeVblankSnapshot = {
	nowCycles: number;
	cyclesIntoFrame: number;
};

export class VblankState {
	private vblankSequence = 0;
	private lastCompletedVblankSequence = 0;
	private vblankCycles = 0;
	private vblankStartCycle = 0;
	private vblankActive = false;
	private frameStartCycle = 0;
	private activeTickCompleted = false;

	constructor(private readonly runtime: Runtime) {
	}

	public get tickCompleted(): boolean {
		return this.activeTickCompleted;
	}

	public configureCycleBudget(): void {
		if (this.vblankCycles <= 0) {
			return;
		}
		const runtime = this.runtime;
		const cycleBudgetPerFrame = runtime.timing.cycleBudgetPerFrame;
		if (this.vblankCycles > cycleBudgetPerFrame) {
			throw new Error('Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankStartCycle = cycleBudgetPerFrame - this.vblankCycles;
		this.reset();
	}

	public setVblankCycles(cycles: number): void {
		if (cycles <= 0) {
			throw new Error('Runtime fault: vblank_cycles must be greater than 0.');
		}
		const runtime = this.runtime;
		const cycleBudgetPerFrame = runtime.timing.cycleBudgetPerFrame;
		if (cycles > cycleBudgetPerFrame) {
			throw new Error('Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankCycles = cycles;
		this.vblankStartCycle = cycleBudgetPerFrame - this.vblankCycles;
		this.reset();
	}

	public getCyclesIntoFrame(): number {
		const runtime = this.runtime;
		return runtime.machine.scheduler.nowCycles - this.frameStartCycle;
	}

	public resetScheduler(): void {
		const runtime = this.runtime;
		runtime.machine.scheduler.reset();
		this.frameStartCycle = 0;
	}

	public reset(): void {
		this.resetScheduler();
		this.vblankActive = false;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		const runtime = this.runtime;
		runtime.machine.inputController.cancelSampleArm();
		runtime.machine.irqController.postLoad();
		runtime.machine.vdp.resetStatus();
		if (this.vblankStartCycle === 0) {
			this.publishVblankTiming(true);
		}
		this.scheduleCurrentFrameTimers();
		refreshDeviceTimings(runtime, runtime.machine.scheduler.nowCycles);
	}

	public capture(): RuntimeVblankSnapshot {
		const nowCycles = this.runtime.machine.scheduler.currentNowCycles();
		return {
			nowCycles,
			cyclesIntoFrame: nowCycles - this.frameStartCycle,
		};
	}

	public restore(state: RuntimeVblankSnapshot): void {
		const runtime = this.runtime;
		runtime.frameScheduler.reset();
		runtime.frameLoop.reset();
		this.resetScheduler();
		runtime.machine.scheduler.setNowCycles(state.nowCycles);
		this.frameStartCycle = state.nowCycles - state.cyclesIntoFrame;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		runtime.machine.irqController.postLoad();
		this.publishVblankTiming(this.vblankStartCycle === 0 || this.getCyclesIntoFrame() >= this.vblankStartCycle);
		this.scheduleCurrentFrameTimers();
		refreshDeviceTimings(runtime, runtime.machine.scheduler.nowCycles);
	}

	public beginTick(): void {
		this.activeTickCompleted = false;
	}

	public abandonTick(): void {
		this.activeTickCompleted = false;
	}

	public handleBeginTimer(): void {
		if (!this.vblankActive) {
			this.enterVblank();
		}
	}

	public handleEndTimer(): void {
		const runtime = this.runtime;
		this.frameStartCycle = runtime.machine.scheduler.nowCycles;
		if (this.vblankStartCycle === 0) {
			this.scheduleCurrentFrameTimers();
			this.enterVblank();
			return;
		}
		if (this.vblankActive) {
			this.publishVblankTiming(false);
		}
		this.scheduleCurrentFrameTimers();
	}

	private scheduleCurrentFrameTimers(): void {
		const runtime = this.runtime;
		runtime.machine.scheduler.scheduleVblankTimer(TIMER_KIND_VBLANK_END, this.frameStartCycle + runtime.timing.cycleBudgetPerFrame);
		if (this.vblankStartCycle > 0 && this.getCyclesIntoFrame() < this.vblankStartCycle) {
			runtime.machine.scheduler.scheduleVblankTimer(TIMER_KIND_VBLANK_BEGIN, this.frameStartCycle + this.vblankStartCycle);
		}
	}

	private publishVblankTiming(active: boolean): void {
		const runtime = this.runtime;
		this.vblankActive = active;
		const cyclesIntoFrame = this.getCyclesIntoFrame();
		runtime.machine.vdp.setScanoutTiming(active, cyclesIntoFrame, runtime.timing.cycleBudgetPerFrame, this.vblankStartCycle);
		runtime.machine.gxGpu.setScanoutTiming(active, cyclesIntoFrame, runtime.timing.cycleBudgetPerFrame, runtime.timing.totalScanlines);
	}

	private enterVblank(): void {
		const runtime = this.runtime;
		this.vblankSequence += 1;
		runtime.machine.vdp.presentReadyFrameOnVblankEdge();
		runtime.machine.inputController.onVblankEdge(runtime.machineElapsedMs(), runtime.machine.scheduler.nowCycles);
		this.publishVblankTiming(true);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		if (runtime.frameLoop.frameActive) {
			this.completeTickIfPending(runtime.frameLoop.frameState, this.vblankSequence);
		}
	}

	private completeTickIfPending(frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) {
			return;
		}
		this.activeTickCompleted = true;
		const runtime = this.runtime;
		runtime.frameScheduler.enqueueTickCompletion(frameState);
		this.lastCompletedVblankSequence = vblankSequence;
	}
}
