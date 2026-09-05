import { clamp } from '../../../common/clamp';
import type { InputControllerInputSource } from '../../devices/input/contracts';
import type { Runtime } from '../runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin, type RuntimeSaveState } from '../save_state';
import { InputJournal } from './input_journal';
import { HistoryInputSource } from './input_source';

export const enum HistoryMode { Disabled, Recording, Replaying, Reviewing }
export const enum HistorySeekResult { Progressed, BackendPending, Complete, Stopped }

export type HistoryOptions = {
	checkpointCapacity: number;
	inputCapacity: number;
	checkpointIntervalCycles: number;
};

type Checkpoint = {
	cycles: number;
	inputSequence: number;
	state: RuntimeSaveState;
};

/** Runtime timeline; deliberately excluded from machine/save-state capture. */
export class RuntimeHistory {
	public mode = HistoryMode.Disabled;
	public checkpointPending = false;
	public readonly inputJournal = new InputJournal();
	public readonly input: HistoryInputSource;
	private checkpoints: (Checkpoint | null)[] = [];
	private firstCheckpoint = 0;
	private count = 0;
	private intervalCycles = 0;
	private nextCheckpointCycles = 0;
	private latestCheckpointInputSequence = 0;
	private endCycles = 0;
	private targetTick = 0;
	public targetCycles = 0;

	public constructor(private readonly runtime: Runtime, liveInput: InputControllerInputSource) {
		this.input = new HistoryInputSource(this, liveInput);
	}

	public get checkpointCount(): number { return this.count; }
	public checkpointCycles(index: number): number { return this.checkpoints[(this.firstCheckpoint + index) % this.checkpoints.length]!.cycles; }
	public get earliestCycles(): number { return this.count === 0 ? 0 : this.checkpoints[this.firstCheckpoint]!.cycles; }
	public get latestCycles(): number { return this.endCycles; }
	public get executionPaused(): boolean { return this.checkpointPending || this.mode === HistoryMode.Reviewing; }

	/** Requests the initial checkpoint. Execution waits for host GPU synchronization. */
	public start(options: HistoryOptions): void {
		this.checkpoints = new Array<Checkpoint | null>(options.checkpointCapacity).fill(null);
		this.firstCheckpoint = 0;
		this.count = 0;
		this.intervalCycles = options.checkpointIntervalCycles;
		this.inputJournal.reset(options.inputCapacity);
		this.targetCycles = 0;
		this.targetTick = 0;
		this.endCycles = this.runtime.machine.scheduler.currentNowCycles();
		this.mode = HistoryMode.Recording;
		this.checkpointPending = true;
	}

	public stop(): void {
		if (this.mode === HistoryMode.Disabled) return;
		if (this.mode === HistoryMode.Replaying || this.mode === HistoryMode.Reviewing) {
			this.runtime.frameScheduler.reset();
			this.runtime.frameLoop.abandonFrameState();
		}
		this.mode = HistoryMode.Disabled;
		this.checkpointPending = false;
		this.checkpoints.length = 0;
		this.count = 0;
		this.firstCheckpoint = 0;
		this.endCycles = 0;
		this.targetCycles = 0;
		this.inputJournal.reset(0);
	}

	/** The host has synchronized VRAM and kept the machine suspended throughout. */
	public captureCheckpoint(): void {
		const cycles = this.runtime.machine.scheduler.currentNowCycles();
		const index = (this.firstCheckpoint + this.count) % this.checkpoints.length;
		const previous = this.checkpoints[index];
		// Only the evicted/inactive slot owns storage that may be overwritten.
		const state = captureRuntimeSaveState(this.runtime, previous === null ? undefined : previous.state);
		const checkpoint = { cycles, inputSequence: this.inputJournal.endSequence, state };
		this.checkpoints[index] = checkpoint;
		if (this.count === this.checkpoints.length) {
			this.firstCheckpoint = (this.firstCheckpoint + 1) % this.checkpoints.length;
		} else {
			this.count += 1;
		}
		this.latestCheckpointInputSequence = checkpoint.inputSequence;
		this.nextCheckpointCycles = cycles + this.intervalCycles;
		this.inputJournal.firstSequence = this.checkpoints[this.firstCheckpoint]!.inputSequence;
		this.checkpointPending = false;
	}

	public recordInputBoundary(high: boolean): void {
		const cycles = this.runtime.machine.scheduler.currentNowCycles();
		const journal = this.inputJournal;
		journal.recordLine(cycles, high);
		this.endCycles = cycles;
		// Retention eviction, not a missing-input recovery path. The newest
		// checkpoint cannot expire: pressure suspends execution before that point.
		// Recycle expired snapshot storage at capture, not inside the ICU poll.
		while (this.checkpoints[this.firstCheckpoint]!.inputSequence < journal.firstSequence) {
			this.firstCheckpoint = (this.firstCheckpoint + 1) % this.checkpoints.length;
			this.count -= 1;
		}
		this.checkpointPending = cycles >= this.nextCheckpointCycles
			|| journal.endSequence - this.latestCheckpointInputSequence === journal.capacity;
	}

	/** Seek endpoints are retained PCRTC boundaries, selected by machine cycles. */
	public beginSeek(cycles: number): void {
		cycles = clamp(cycles, this.earliestCycles, this.endCycles);
		let checkpoint = this.checkpoints[this.firstCheckpoint]!;
		for (let index = 1; index < this.count; index += 1) {
			const candidate = this.checkpoints[(this.firstCheckpoint + index) % this.checkpoints.length]!;
			if (candidate.cycles > cycles) break;
			checkpoint = candidate;
		}
		const endSequence = this.inputJournal.endAt(cycles);
		this.targetCycles = endSequence === checkpoint.inputSequence ? checkpoint.cycles : this.inputJournal.cycleAt(endSequence - 1);
		this.targetTick = checkpoint.state.machineState.frameScheduler.lastTickSequence + endSequence - checkpoint.inputSequence;
		applyRuntimeSaveState(this.runtime, checkpoint.state, RuntimeRestoreOrigin.HistorySeek);
		this.runtime.frameScheduler.reset();
		this.runtime.frameLoop.abandonFrameState();
		this.inputJournal.replaySequence = checkpoint.inputSequence;
		this.checkpointPending = false;
		this.mode = this.runtime.frameScheduler.lastTickSequence === this.targetTick ? HistoryMode.Reviewing : HistoryMode.Replaying;
	}

	/** One bounded machine-cycle grant. The caller services backend work/yields to its event loop. */
	public advanceSeek(cycleGrant: number): HistorySeekResult {
		if (this.mode === HistoryMode.Reviewing) return HistorySeekResult.Complete;
		const runtime = this.runtime;
		const before = runtime.machine.scheduler.currentNowCycles();
		runtime.frameScheduler.runToNextLogicalTick(cycleGrant);
		if (runtime.frameScheduler.lastTickSequence === this.targetTick) {
			this.mode = HistoryMode.Reviewing;
			return HistorySeekResult.Complete;
		}
		if (runtime.machine.gxGpu.backendServicePending() || runtime.machine.gxGpu.backendServiceBlocksMachine()) return HistorySeekResult.BackendPending;
		return runtime.machine.scheduler.currentNowCycles() === before ? HistorySeekResult.Stopped : HistorySeekResult.Progressed;
	}

	public cancelSeek(): void { this.mode = HistoryMode.Reviewing; }

	/** A branch needs a synchronized checkpoint; rejoining the recorded end keeps its capture schedule. */
	public resumeRecording(): void {
		const cycles = this.runtime.machine.scheduler.currentNowCycles();
		const rejoiningLatest = cycles === this.endCycles;
		while (this.count > 0) {
			const index = (this.firstCheckpoint + this.count - 1) % this.checkpoints.length;
			if (this.checkpoints[index]!.cycles <= cycles) break;
			// Discard the future logically; retain slot storage for the new branch.
			this.count -= 1;
		}
		this.inputJournal.branch();
		this.runtime.frameScheduler.reset();
		this.runtime.frameLoop.abandonFrameState();
		this.endCycles = cycles;
		this.mode = HistoryMode.Recording;
		this.checkpointPending = !rejoiningLatest || cycles >= this.nextCheckpointCycles
			|| this.inputJournal.endSequence - this.latestCheckpointInputSequence === this.inputJournal.capacity;
	}
}
