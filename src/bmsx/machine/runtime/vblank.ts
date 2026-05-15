import { IRQ_VBLANK } from '../bus/io';
import { FrameState, Runtime } from './runtime';
import { refreshDeviceTimings } from './timing/config';
import { TIMER_KIND_VBLANK_BEGIN, TIMER_KIND_VBLANK_END } from '../scheduler/device';

export type RuntimeVblankSnapshot = {
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
		runtime.machine.inputController.sampleLatch.cancel();
		runtime.machine.irqController.postLoad();
		runtime.machine.vdp.resetStatus();
		if (this.vblankStartCycle === 0) {
			this.publishVblankTiming(true);
		}
		this.scheduleCurrentFrameTimers();
		refreshDeviceTimings(runtime, runtime.machine.scheduler.nowCycles);
	}

	public capture(): RuntimeVblankSnapshot {
		return {
			cyclesIntoFrame: this.getCyclesIntoFrame(),
		};
	}

	public restore(state: RuntimeVblankSnapshot): void {
		const runtime = this.runtime;
		runtime.frameScheduler.reset();
		runtime.frameLoop.reset();
		runtime.screen.reset();
		this.resetScheduler();
		runtime.machine.scheduler.setNowCycles(state.cyclesIntoFrame);
		this.frameStartCycle = 0;
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
		runtime.machine.vdp.setScanoutTiming(active, this.getCyclesIntoFrame(), runtime.timing.cycleBudgetPerFrame, this.vblankStartCycle);
	}

	private enterVblank(): void {
		const runtime = this.runtime;
		this.vblankSequence += 1;
		runtime.machine.vdp.presentReadyFrameOnVblankEdge();
		runtime.machine.inputController.sampleLatch.onVblankEdge(runtime.frameLoop.currentTimeMs, runtime.machine.scheduler.nowCycles);
		this.publishVblankTiming(true);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		const frameState = runtime.frameLoop.currentFrameState;
		if (frameState !== null) {
			this.completeTickIfPending(frameState, this.vblankSequence);
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
