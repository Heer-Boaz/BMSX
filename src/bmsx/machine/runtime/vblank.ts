import { IRQ_VBLANK } from '../bus/io';
import { FrameState, Runtime } from './runtime';
import { advanceRuntimeTime, runDueRuntimeTimers } from './cpu_executor';
import { refreshDeviceTimings } from './timing/config';
import { TIMER_KIND_VBLANK_BEGIN, TIMER_KIND_VBLANK_END } from '../scheduler/device';
import { applyVdpFrameBufferTextureWrites, presentVdpFrameBufferPages } from '../../render/vdp/framebuffer';

export type RuntimeVblankSnapshot = {
	cyclesIntoFrame: number;
};

export class VblankState {
	private clearBackQueuesAfterIrqWake = false;
	private haltIrqSignalSequence = 0;
	private haltIrqWaitArmed = false;
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
		runtime.machine.inputController.sampleArmed = false;
		runtime.machine.irqController.postLoad();
		this.resetHaltIrqWait();
		runtime.machine.vdp.resetStatus();
		if (this.vblankStartCycle === 0) {
			this.setVblankStatus(true);
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
		this.clearHaltUntilIrq();
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
		this.setVblankStatus(this.vblankStartCycle === 0 || this.getCyclesIntoFrame() >= this.vblankStartCycle);
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
		if (this.vblankActive) {
			this.setVblankStatus(false);
		}
		const runtime = this.runtime;
		this.frameStartCycle = runtime.machine.scheduler.nowCycles;
		this.scheduleCurrentFrameTimers();
		if (this.vblankStartCycle === 0) {
			this.enterVblank();
		}
	}

	public clearHaltUntilIrq(): void {
		const runtime = this.runtime;
		runtime.machine.cpu.clearHaltUntilIrq();
		this.resetHaltIrqWait();
		this.clearBackQueuesAfterIrqWake = false;
	}

	public consumeBackQueueClearAfterIrqWake(): boolean {
		if (!this.clearBackQueuesAfterIrqWake) {
			return false;
		}
		this.clearBackQueuesAfterIrqWake = false;
		return true;
	}

	public runHaltedUntilIrq(state: FrameState): boolean {
		const runtime = this.runtime;
		const cpu = runtime.machine.cpu;
		const irqController = runtime.machine.irqController;
		const scheduler = runtime.machine.scheduler;
		let cycleBudgetRemaining = state.cycleBudgetRemaining;
		runDueRuntimeTimers(runtime);
		if (!cpu.isHaltedUntilIrq()) {
			this.resetHaltIrqWait();
			return false;
		}
		if (this.tryCompleteTickOnPendingVblankIrq(state)) {
			return true;
		}
		while (true) {
			const signalSequence = irqController.signalSequence;
			if (!this.haltIrqWaitArmed) {
				if (irqController.pendingFlags() !== 0) {
					cpu.clearHaltUntilIrq();
					return this.activeTickCompleted;
				}
				this.haltIrqSignalSequence = signalSequence;
				this.haltIrqWaitArmed = true;
			} else if (signalSequence !== this.haltIrqSignalSequence) {
				cpu.clearHaltUntilIrq();
				this.resetHaltIrqWait();
				return this.activeTickCompleted;
			}
			if (cycleBudgetRemaining > 0) {
				const cyclesToTarget = scheduler.nextDeadline() - scheduler.nowCycles;
				if (cyclesToTarget <= 0) {
					runDueRuntimeTimers(runtime);
					continue;
				}
				const idleCycles = cyclesToTarget < cycleBudgetRemaining ? cyclesToTarget : cycleBudgetRemaining;
				cycleBudgetRemaining -= idleCycles;
				state.cycleBudgetRemaining = cycleBudgetRemaining;
				advanceRuntimeTime(runtime, idleCycles);
				if (this.tryCompleteTickOnPendingVblankIrq(state)) {
					return true;
				}
				continue;
			}
			return true;
		}
	}

	private scheduleCurrentFrameTimers(): void {
		const runtime = this.runtime;
		runtime.machine.scheduler.scheduleVblankTimer(TIMER_KIND_VBLANK_END, this.frameStartCycle + runtime.timing.cycleBudgetPerFrame);
		if (this.vblankStartCycle > 0 && this.getCyclesIntoFrame() < this.vblankStartCycle) {
			runtime.machine.scheduler.scheduleVblankTimer(TIMER_KIND_VBLANK_BEGIN, this.frameStartCycle + this.vblankStartCycle);
		}
	}

	private setVblankStatus(active: boolean): void {
		const runtime = this.runtime;
		this.vblankActive = active;
		runtime.machine.vdp.setVblankStatus(active);
	}

	private enterVblank(): void {
		const runtime = this.runtime;
		this.vblankSequence += 1;
		this.commitFrameOnVblankEdge();
		runtime.machine.inputController.onVblankEdge();
		this.setVblankStatus(true);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		const frameState = runtime.frameLoop.currentFrameState;
		if (frameState !== null && this.isFrameBoundaryHalt()) {
			this.completeTickIfPending(frameState, this.vblankSequence);
			this.clearBackQueuesAfterIrqWake = true;
		}
	}

	private resetHaltIrqWait(): void {
		this.haltIrqWaitArmed = false;
		this.haltIrqSignalSequence = 0;
	}

	private tryCompleteTickOnPendingVblankIrq(state: FrameState): boolean {
		if (!this.isFrameBoundaryHalt()) {
			return false;
		}
		if (this.vblankSequence === 0) {
			return false;
		}
		const runtime = this.runtime;
		if ((runtime.machine.irqController.pendingFlags() & IRQ_VBLANK) === 0) {
			return false;
		}
		if (this.lastCompletedVblankSequence === this.vblankSequence) {
			return false;
		}
		this.completeTickIfPending(state, this.vblankSequence);
		this.clearBackQueuesAfterIrqWake = true;
		runtime.machine.cpu.clearHaltUntilIrq();
		this.resetHaltIrqWait();
		return true;
	}

	private isFrameBoundaryHalt(): boolean {
		const runtime = this.runtime;
		return runtime.machine.cpu.getFrameDepth() === 1
			&& runtime.pendingCall === 'entry'
			&& runtime.machine.cpu.isHaltedUntilIrq();
	}

	private commitFrameOnVblankEdge(): void {
		const runtime = this.runtime;
		const vdp = runtime.machine.vdp;
		if (vdp.presentReadyFrameOnVblankEdge()) {
			applyVdpFrameBufferTextureWrites(vdp);
			presentVdpFrameBufferPages();
			vdp.swapFrameBufferReadbackPages();
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
