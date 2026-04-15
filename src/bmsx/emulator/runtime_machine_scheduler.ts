import { $ } from '../core/engine_core';
import { clamp } from '../utils/clamp';
import type { Runtime } from './runtime';

export type TickCompletion = {
	sequence: number;
	remaining: number;
	visualCommitted: boolean;
	vdpFrameCost: number;
	vdpFrameHeld: boolean;
};

type BudgetFrameState = {
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
};

const TICK_COMPLETION_QUEUE_CAPACITY = 16;
function createTickCompletionQueue(): TickCompletion[] {
	const queue = new Array<TickCompletion>(TICK_COMPLETION_QUEUE_CAPACITY);
	for (let index = 0; index < TICK_COMPLETION_QUEUE_CAPACITY; index += 1) {
		queue[index] = {
			sequence: 0,
			remaining: 0,
			visualCommitted: true,
			vdpFrameCost: 0,
			vdpFrameHeld: false,
		};
	}
	return queue;
}

export class RuntimeMachineSchedulerState {
	private queuedCycleBudget = 0;
	private queuedCycleRemainder = 0;
	private readonly tickCompletionQueue = createTickCompletionQueue();
	private tickCompletionReadIndex = 0;
	private tickCompletionWriteIndex = 0;
	private tickCompletionCount = 0;
	private debugFrameReportAtMs = 0;
	private debugFrameCount = 0;
	private debugFrameCyclesUsedAcc = 0;
	private debugFrameRemainingAcc = 0;
	private debugFrameYieldsAcc = 0;
	private debugFrameGrantedAcc = 0;
	private debugFrameCarryAcc = 0;
	private debugTickYieldsBefore = 0;

	private queueHostCycles(runtime: Runtime, deltaMs: number): void {
		const totalCycles = this.queuedCycleRemainder + (deltaMs * runtime.cpuHz / 1000);
		const wholeCycles = Math.floor(totalCycles);
		this.queuedCycleRemainder = totalCycles - wholeCycles;
		this.queuedCycleBudget = clamp(this.queuedCycleBudget + wholeCycles, 0, Number.MAX_SAFE_INTEGER);
	}

	private canRunScheduledUpdate(runtime: Runtime): boolean {
		if (!runtime.luaInitialized || !runtime.tickEnabled || runtime.luaRuntimeFailed) {
			return false;
		}
		const state = runtime.currentFrameState;
		if (state !== null && state.cycleBudgetRemaining > 0) {
			return true;
		}
		return this.queuedCycleBudget >= runtime.cycleBudgetPerFrame;
	}

	private consumeQueuedFrame(runtime: Runtime): boolean {
		if (this.queuedCycleBudget < runtime.cycleBudgetPerFrame) {
			return false;
		}
		this.queuedCycleBudget -= runtime.cycleBudgetPerFrame;
		return true;
	}

	public clearQueuedTime(): void {
		this.queuedCycleBudget = 0;
		this.queuedCycleRemainder = 0;
	}

	public clearTickCompletionQueue(runtime: Runtime): void {
		this.tickCompletionReadIndex = 0;
		this.tickCompletionWriteIndex = 0;
		this.tickCompletionCount = 0;
		runtime.lastTickConsumedSequence = runtime.lastTickSequence;
	}

	public reset(runtime: Runtime): void {
		this.clearQueuedTime();
		this.clearTickCompletionQueue(runtime);
	}

	public run(runtime: Runtime, hostDeltaMs: number): void {
		this.queueHostCycles(runtime, hostDeltaMs);
		while (this.canRunScheduledUpdate(runtime)) {
			const progressed = runtime.tickUpdate();
			if (runtime.executionOverlayActive) {
				this.clearQueuedTime();
				break;
			}
			if (runtime.hasActiveTick() && !progressed) {
				break;
			}
		}
	}

	public consumeTickCompletion(runtime: Runtime, out: TickCompletion): boolean {
		if (this.tickCompletionCount <= 0) {
			return false;
		}
		const slot = this.tickCompletionQueue[this.tickCompletionReadIndex]!;
		out.sequence = slot.sequence;
		out.remaining = slot.remaining;
		out.visualCommitted = slot.visualCommitted;
		out.vdpFrameCost = slot.vdpFrameCost;
		out.vdpFrameHeld = slot.vdpFrameHeld;
		this.tickCompletionReadIndex = (this.tickCompletionReadIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
		this.tickCompletionCount -= 1;
		runtime.lastTickConsumedSequence = out.sequence;
		return true;
	}

	public enqueueTickCompletion(runtime: Runtime, frameState: {
		cycleBudgetRemaining: number;
		cycleBudgetGranted: number;
		cycleCarryGranted: number;
		activeCpuUsedCycles: number;
	}): void {
		if (this.tickCompletionCount >= TICK_COMPLETION_QUEUE_CAPACITY) {
			throw new Error('Runtime fault: tick completion queue overflow.');
		}
		const slot = this.tickCompletionQueue[this.tickCompletionWriteIndex]!;
		const sequence = runtime.lastTickSequence + 1;
		slot.sequence = sequence;
		slot.remaining = frameState.cycleBudgetRemaining;
		slot.visualCommitted = runtime.vdp.lastFrameCommitted;
		slot.vdpFrameCost = runtime.vdp.lastFrameCost;
		slot.vdpFrameHeld = runtime.vdp.lastFrameHeld;
		this.tickCompletionWriteIndex = (this.tickCompletionWriteIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
		this.tickCompletionCount += 1;
		runtime.lastTickBudgetGranted = frameState.cycleBudgetGranted;
		runtime.lastTickCpuBudgetGranted = frameState.cycleBudgetGranted;
		runtime.lastTickCpuUsedCycles = frameState.activeCpuUsedCycles;
		runtime.lastTickBudgetRemaining = frameState.cycleBudgetRemaining;
		runtime.lastTickVisualFrameCommitted = slot.visualCommitted;
		runtime.lastTickVdpFrameCost = slot.vdpFrameCost;
		runtime.lastTickVdpFrameHeld = slot.vdpFrameHeld;
		runtime.lastTickCompleted = true;
		runtime.lastTickSequence = sequence;
		const debugTickRate = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugTickRate) {
			const cyclesUsed = frameState.activeCpuUsedCycles;
			const yieldsThisFrame = runtime.debugCycleYieldsTotal - this.debugTickYieldsBefore;
			this.debugFrameCount += 1;
			this.debugFrameCyclesUsedAcc += cyclesUsed;
			this.debugFrameRemainingAcc += frameState.cycleBudgetRemaining;
			this.debugFrameYieldsAcc += yieldsThisFrame;
			this.debugFrameGrantedAcc += frameState.cycleBudgetGranted;
			this.debugFrameCarryAcc += frameState.cycleCarryGranted;
			const now = $.platform.clock.now();
			const elapsedMs = now - this.debugFrameReportAtMs;
			if (elapsedMs >= 1000) {
				const scale = 1000 / elapsedMs;
				const cyclesPerSec = this.debugFrameCyclesUsedAcc * scale;
				const cyclesPerFrame = this.debugFrameCyclesUsedAcc / this.debugFrameCount;
				const remainingPerFrame = this.debugFrameRemainingAcc / this.debugFrameCount;
				const yieldsPerFrame = this.debugFrameYieldsAcc / this.debugFrameCount;
				const grantedPerFrame = this.debugFrameGrantedAcc / this.debugFrameCount;
				const carryPerFrame = this.debugFrameCarryAcc / this.debugFrameCount;
				console.info(`cycles/sec=${cyclesPerSec.toFixed(1)} cycles/frame=${cyclesPerFrame.toFixed(1)} remaining/frame=${remainingPerFrame.toFixed(1)} yields/frame=${yieldsPerFrame.toFixed(2)} budget=${runtime.cycleBudgetPerFrame} granted=${grantedPerFrame.toFixed(1)} carry=${carryPerFrame.toFixed(1)}`);
				this.debugFrameReportAtMs = now;
				this.debugFrameCount = 0;
				this.debugFrameCyclesUsedAcc = 0;
				this.debugFrameRemainingAcc = 0;
				this.debugFrameYieldsAcc = 0;
				this.debugFrameGrantedAcc = 0;
				this.debugFrameCarryAcc = 0;
			}
		}
	}

	public refillFrameBudget(runtime: Runtime, frameState: BudgetFrameState): boolean {
		if (!this.consumeQueuedFrame(runtime)) {
			return false;
		}
		frameState.cycleBudgetRemaining += runtime.cycleBudgetPerFrame;
		frameState.cycleBudgetGranted += runtime.cycleBudgetPerFrame;
		return true;
	}

	public startScheduledFrame(runtime: Runtime): boolean {
		if (!this.consumeQueuedFrame(runtime)) {
			return false;
		}
		const debugTickRate = Boolean((globalThis as any).__bmsx_debug_tickrate);
		if (debugTickRate) {
			if (this.debugFrameReportAtMs === 0) {
				this.debugFrameReportAtMs = $.platform.clock.now();
			}
			this.debugTickYieldsBefore = runtime.debugCycleYieldsTotal;
		}
		runtime.lastTickCompleted = false;
		runtime.beginFrameState();
		return true;
	}
}
