import { IRQ_VBLANK } from '../bus/io';
import type { FrameState, Runtime } from './runtime';

export type RuntimeVblankSnapshot = {
	cyclesIntoFrame: number;
};

export class RuntimeVblankState {
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

	public get tickCompleted(): boolean {
		return this.activeTickCompleted;
	}

	public configureCycleBudget(runtime: Runtime): void {
		if (this.vblankCycles <= 0) {
			return;
		}
		if (this.vblankCycles > runtime.timing.cycleBudgetPerFrame) {
			throw new Error('Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankStartCycle = runtime.timing.cycleBudgetPerFrame - this.vblankCycles;
		this.reset(runtime);
	}

	public setVblankCycles(runtime: Runtime, cycles: number): void {
		if (cycles <= 0) {
			throw new Error('Runtime fault: vblank_cycles must be greater than 0.');
		}
		if (cycles > runtime.timing.cycleBudgetPerFrame) {
			throw new Error('Runtime fault: vblank_cycles must be less than or equal to cycles_per_frame.');
		}
		this.vblankCycles = cycles;
		this.vblankStartCycle = runtime.timing.cycleBudgetPerFrame - this.vblankCycles;
		this.reset(runtime);
	}

	public getCyclesIntoFrame(runtime: Runtime): number {
		return runtime.machine.scheduler.nowCycles - this.frameStartCycle;
	}

	public resetScheduler(runtime: Runtime): void {
		runtime.machine.scheduler.reset();
		this.frameStartCycle = 0;
	}

	public reset(runtime: Runtime): void {
		this.resetScheduler(runtime);
		this.vblankActive = false;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		runtime.machine.inputController.sampleArmed = false;
		runtime.machine.irqController.postLoad();
		this.resetHaltIrqWait();
		runtime.machine.vdp.resetStatus();
		if (this.vblankStartCycle === 0) {
			this.setVblankStatus(runtime, true);
		}
		this.scheduleCurrentFrameTimers(runtime);
		runtime.refreshDeviceTimings(runtime.machine.scheduler.nowCycles);
	}

	public capture(runtime: Runtime): RuntimeVblankSnapshot {
		return {
			cyclesIntoFrame: this.getCyclesIntoFrame(runtime),
		};
	}

	public restore(runtime: Runtime, state: RuntimeVblankSnapshot): void {
		this.clearHaltUntilIrq(runtime);
		runtime.machineScheduler.reset();
		runtime.frameLoop.reset();
		runtime.screen.reset();
		this.resetScheduler(runtime);
		runtime.machine.scheduler.setNowCycles(state.cyclesIntoFrame);
		this.frameStartCycle = 0;
		this.vblankSequence = 0;
		this.lastCompletedVblankSequence = 0;
		this.activeTickCompleted = false;
		runtime.machine.irqController.postLoad();
		const vblankActive = (this.vblankStartCycle === 0)
			|| (this.getCyclesIntoFrame(runtime) >= this.vblankStartCycle);
		this.setVblankStatus(runtime, vblankActive);
		this.scheduleCurrentFrameTimers(runtime);
		runtime.refreshDeviceTimings(runtime.machine.scheduler.nowCycles);
	}

	public beginTick(): void {
		this.activeTickCompleted = false;
	}

	public abandonTick(): void {
		this.activeTickCompleted = false;
	}

	public handleBeginTimer(runtime: Runtime): void {
		if (!this.vblankActive) {
			this.enterVblank(runtime);
		}
	}

	public handleEndTimer(runtime: Runtime): void {
		if (this.vblankActive) {
			this.leaveVblank(runtime);
		}
		this.frameStartCycle = runtime.machine.scheduler.nowCycles;
		this.scheduleCurrentFrameTimers(runtime);
		if (this.vblankStartCycle === 0) {
			this.enterVblank(runtime);
		}
	}

	public clearHaltUntilIrq(runtime: Runtime): void {
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

	public runHaltedUntilIrq(runtime: Runtime, state: FrameState): boolean {
		runtime.runDueTimers();
		if (!runtime.machine.cpu.isHaltedUntilIrq()) {
			this.resetHaltIrqWait();
			return false;
		}
		if (this.tryCompleteTickOnPendingVblankIrq(runtime, state)) {
			return true;
		}
		if (!this.haltIrqWaitArmed) {
			const pendingFlags = runtime.machine.irqController.pendingFlags();
			if (pendingFlags !== 0) {
				runtime.machine.cpu.clearHaltUntilIrq();
				return this.activeTickCompleted;
			}
			this.haltIrqSignalSequence = runtime.machine.irqController.signalSequence;
			this.haltIrqWaitArmed = true;
		}
		while (true) {
			if (runtime.machine.irqController.signalSequence !== this.haltIrqSignalSequence) {
				runtime.machine.cpu.clearHaltUntilIrq();
				this.resetHaltIrqWait();
				return this.activeTickCompleted;
			}
			if (state.cycleBudgetRemaining > 0) {
				const cyclesToTarget = runtime.machine.scheduler.nextDeadline() - runtime.machine.scheduler.nowCycles;
				if (cyclesToTarget <= 0) {
					runtime.runDueTimers();
					continue;
				}
				const idleCycles = cyclesToTarget < state.cycleBudgetRemaining ? cyclesToTarget : state.cycleBudgetRemaining;
				state.cycleBudgetRemaining -= idleCycles;
				runtime.advanceTime(idleCycles);
				if (this.tryCompleteTickOnPendingVblankIrq(runtime, state)) {
					return true;
				}
				continue;
			}
			return true;
		}
	}

	private scheduleCurrentFrameTimers(runtime: Runtime): void {
		runtime.machine.scheduler.scheduleVblankEnd(this.frameStartCycle + runtime.timing.cycleBudgetPerFrame);
		if (this.vblankStartCycle > 0 && this.getCyclesIntoFrame(runtime) < this.vblankStartCycle) {
			runtime.machine.scheduler.scheduleVblankBegin(this.frameStartCycle + this.vblankStartCycle);
		}
	}

	private setVblankStatus(runtime: Runtime, active: boolean): void {
		this.vblankActive = active;
		runtime.machine.vdp.setVblankStatus(active);
	}

	private enterVblank(runtime: Runtime): void {
		this.vblankSequence += 1;
		this.commitFrameOnVblankEdge(runtime);
		runtime.machine.inputController.onVblankEdge();
		this.setVblankStatus(runtime, true);
		runtime.machine.irqController.raise(IRQ_VBLANK);
		const frameState = runtime.frameLoop.currentFrameState;
		if (frameState !== null && this.isFrameBoundaryHalt(runtime)) {
			this.completeTickIfPending(runtime, frameState, this.vblankSequence);
			this.clearBackQueuesAfterIrqWake = true;
		}
	}

	private leaveVblank(runtime: Runtime): void {
		this.setVblankStatus(runtime, false);
	}

	private resetHaltIrqWait(): void {
		this.haltIrqWaitArmed = false;
		this.haltIrqSignalSequence = 0;
	}

	private tryCompleteTickOnPendingVblankIrq(runtime: Runtime, state: FrameState): boolean {
		if (!this.isFrameBoundaryHalt(runtime)) {
			return false;
		}
		if (this.vblankSequence === 0) {
			return false;
		}
		const pendingFlags = runtime.machine.irqController.pendingFlags();
		if ((pendingFlags & IRQ_VBLANK) === 0) {
			return false;
		}
		if (this.lastCompletedVblankSequence === this.vblankSequence) {
			return false;
		}
		this.completeTickIfPending(runtime, state, this.vblankSequence);
		this.clearBackQueuesAfterIrqWake = true;
		runtime.machine.cpu.clearHaltUntilIrq();
		this.resetHaltIrqWait();
		return true;
	}

	private isFrameBoundaryHalt(runtime: Runtime): boolean {
		return runtime.machine.cpu.getFrameDepth() === 1
			&& runtime.pendingCall === 'entry'
			&& runtime.machine.cpu.isHaltedUntilIrq();
	}

	private commitFrameOnVblankEdge(runtime: Runtime): void {
		runtime.machine.vdp.syncRegisters();
		runtime.machine.vdp.presentReadyFrameOnVblankEdge();
		runtime.machine.vdp.commitViewSnapshot();
	}

	private completeTickIfPending(runtime: Runtime, frameState: FrameState, vblankSequence: number): void {
		if (this.lastCompletedVblankSequence === vblankSequence) {
			return;
		}
		this.activeTickCompleted = true;
		runtime.machineScheduler.enqueueTickCompletion(runtime, frameState);
		this.lastCompletedVblankSequence = vblankSequence;
	}
}
