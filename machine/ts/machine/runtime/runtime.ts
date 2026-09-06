import type { Closure } from '../cpu/closure';
import { EMPTY_CALL_ARGS, type Value } from '../cpu/value';
import type { RuntimeOptions } from './options';
import { FrameLoopState } from './frame/loop';
import { FrameSchedulerState } from '../scheduler/frame';
import { DEVICE_SERVICE_GPU } from '../scheduler/device';
import { TimingState } from './timing/state';
import { VblankState } from './vblank';
import { CpuExecutionState } from './cpu_executor';
import { refreshDeviceTimings } from './timing/config';
import { HZ_SCALE } from '../../spec/bmsx/timing';
import type { GxGpuPcrtcTiming } from '../devices/gx/gpu_pcrtc';
import type { InputControllerInputSource } from '../devices/input/contracts';
import { Machine } from '../machine';
import { Memory } from '../memory/memory';
import { RuntimeHistory } from './history/history';

export class Runtime {
	public readonly timing: TimingState;
	public cpuUsageCyclesUsed(): number {
		return this.frameLoop.frameActive ? this.frameLoop.frameState.activeCpuUsedCycles : this.frameScheduler.lastTickCpuUsedCycles;
	}

	public cpuUsageCyclesGranted(): number {
		return this.frameLoop.frameActive
			? this.frameLoop.frameState.cycleBudgetGranted
			: (this.frameScheduler.lastTickSequence === 0 ? this.timing.cycleBudgetPerFrame : this.frameScheduler.lastTickCpuBudgetGranted);
	}

	public pendingCall: 'entry' | null = null;
	public get isDrawPending(): boolean {
		return this.pendingCall === 'entry';
	}

	public readonly frameScheduler: FrameSchedulerState;
	public readonly frameLoop: FrameLoopState;
	public readonly vblank: VblankState;
	public readonly cpuExecution: CpuExecutionState;
	public readonly machine: Machine;
	public readonly history: RuntimeHistory;
	/** Host/tooling observers must discard borrowed inspection state after a restore. */
	public onStateRestored: (() => void) | null = null;
	private readonly completionValues: Value[] = [];

	public resetHardwareState(): void {
		this.history.stop();
		this.machine.scheduler.reset();
		this.machine.resetDevices();
		this.vblank.reset();
		refreshDeviceTimings(this, this.machine.scheduler.nowCycles);
		this.machine.runDeviceService(DEVICE_SERVICE_GPU);
		this.applyPublishedGxGpuPcrtcTiming(this.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	}

	public resetForSystemBoot(): void {
		this.cpuExecution.reset();
		this.frameLoop.resetFrameState();
		this.pendingCall = null;
		this.completionValues.length = 0;
		this.machine.cpu.clearExecutionEnvironment();
		this.machine.memory.clearIoSlots();
		this.resetHardwareState();
	}

	public boot(): void {
		this.completionValues.length = 0;
		this.machine.cpu.reset();
		this.machine.cpu.installBootPrimitives();
		this.finishSystemBoot();
	}

	public rebootSystem(): void {
		this.resetForSystemBoot();
		this.machine.cpu.reset();
		this.machine.cpu.installBootPrimitives();
		this.finishSystemBoot();
	}

	public suspendExecution(): void {
		this.pendingCall = null;
		this.frameLoop.abandonFrameState();
		this.frameScheduler.clearQueuedTime();
	}

	private finishSystemBoot(): void {
		this.pendingCall = 'entry';
	}

	/** The borrowed result view is invalidated by subsequent CPU execution, call entry, reset, or state restore. */
	public callClosure(fn: Closure, args: ReadonlyArray<Value> = EMPTY_CALL_ARGS): ReadonlyArray<Value> {
		const cpu = this.machine.cpu;
		const scheduler = this.machine.scheduler;
		if (scheduler.isCpuSliceActive()) {
			throw new Error('External Lua closure execution requires a suspended CPU.');
		}
		this.history.stop();
		const depth = cpu.getFrameDepth();
		const previousBudget = cpu.instructionBudgetRemaining;
		try {
			this.completionValues.length = 0;
			cpu.beginCompletionCall(fn, args);
			this.cpuExecution.runSuspendedUntilDepth(depth);
			return this.readCompletionValues();
		} finally {
			cpu.instructionBudgetRemaining = previousBudget;
		}
	}

	/** The borrowed result view is invalidated by subsequent result reads. */
	public readCompletionValues(): ReadonlyArray<Value> {
		this.machine.cpu.readCompletionValues(this.completionValues);
		return this.completionValues;
	}

	public completionCallPending(): boolean {
		return this.machine.cpu.completionCallPending();
	}

	public constructor(
		options: RuntimeOptions,
		input: InputControllerInputSource,
	) {
		this.frameScheduler = new FrameSchedulerState(this);
		this.frameLoop = new FrameLoopState(this);
		this.vblank = new VblankState(this);
		this.cpuExecution = new CpuExecutionState(this);
		this.timing = new TimingState(options.machineModel);
		this.history = new RuntimeHistory(this, input);
		this.machine = new Machine(
			new Memory({
				systemRom: options.systemRomBytes,
				cartridgeSlots: options.cartridgeSlots,
			}, options.machineModel.ramBytes),
			this.history.input,
			options.machineModel,
		);
		this.machine.memory.clearIoSlots();
		this.machine.resetDevices();
		refreshDeviceTimings(this, this.machine.scheduler.currentNowCycles());
		this.machine.runDeviceService(DEVICE_SERVICE_GPU);
		this.applyPublishedGxGpuPcrtcTiming(this.machine.gxGpu.readDeviceOutput().pcrtcTiming);
	}

	public applyPublishedGxGpuPcrtcTiming(pcrtcTiming: GxGpuPcrtcTiming): void {
		const timing = this.timing;
		if (timing.pcrtcRevision === pcrtcTiming.revision
			&& timing.pcrtcRunning === pcrtcTiming.running
			&& timing.ufpsScaled === pcrtcTiming.refreshUfpsScaled
			&& timing.cycleBudgetPerFrame === pcrtcTiming.nextVblankCycleBudget
			&& timing.totalHalfLines === pcrtcTiming.totalHalfLines
			&& timing.activeDisplayHalfLines === pcrtcTiming.activeDisplayHalfLines) {
			return;
		}
		timing.pcrtcRevision = pcrtcTiming.revision;
		timing.pcrtcRunning = pcrtcTiming.running;
		timing.totalHalfLines = pcrtcTiming.totalHalfLines;
		timing.activeDisplayHalfLines = pcrtcTiming.activeDisplayHalfLines;
		if (!pcrtcTiming.running) {
			timing.ufpsScaled = 0;
			timing.ufps = 0;
			timing.frameDurationMs = 0;
			timing.cycleBudgetPerFrame = 0;
			return;
		}
		timing.cycleBudgetPerFrame = pcrtcTiming.nextVblankCycleBudget;
		timing.ufpsScaled = pcrtcTiming.refreshUfpsScaled;
		timing.ufps = pcrtcTiming.refreshUfpsScaled / HZ_SCALE;
		timing.frameDurationMs = pcrtcTiming.frameDurationMs;
	}

}
