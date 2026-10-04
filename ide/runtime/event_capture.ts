import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import { executionDomainBit } from '../../machine/ts/spec/blua32/execution_domain';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import type { RuntimeSourceState } from './sources';
import { bindFunctionProbe, type FunctionProbe, type FunctionProbeBinding } from './function_probe';
import { GuestValueSnapshot, type ValueSnapshot } from './value_snapshot';

export type CapturedEvent = {
	readonly sequence: number;
	readonly capture: number;
	readonly domain: ExecutionDomainId;
	readonly cycles: number;
	/** Number of completed ticks at emission, not a claim that this frame is complete. */
	readonly completedTick: number;
	readonly event: ValueSnapshot;
	readonly emitter: ValueSnapshot;
	readonly payload: ValueSnapshot;
};
export type EventCaptureStatus = 'idle' | 'recording' | 'stopped' | 'full' | 'runtime-changed' | 'history-review'
	| 'image-unavailable' | Exclude<FunctionProbeBinding['status'], 'bound'>;

/** Host-side emission history. Cartlib dispatch and the guest heap are unchanged. */
export class RuntimeEventCapture {
	private readonly captured: CapturedEvent[] = [];
	public get records(): readonly CapturedEvent[] { return this.captured; }
	public revision = 0;
	public generation = 0;
	public status: EventCaptureStatus = 'idle';
	public domainMask = 0;
	private capture = 0;
	private sequence = 0;
	private readonly points = new Map<number, FunctionProbe>();
	private readonly recordingListeners = new Set<() => void>();
	private readonly snapshot: GuestValueSnapshot;

	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		private readonly changedBinding: () => void,
		public readonly capacity = 2048,
	) {
		this.snapshot = new GuestValueSnapshot(runtime.machine.cpu.stringPool);
	}

	/** State transitions only; appending events does not invalidate workbench chrome. */
	public onDidChangeRecording(listener: () => void): () => void {
		this.recordingListeners.add(listener);
		return () => this.recordingListeners.delete(listener);
	}

	public start(): EventCaptureStatus {
		if (this.status === 'recording') return this.status;
		this.revision++;
		if (this.runtime.history.mode === HistoryMode.Replaying || this.runtime.history.mode === HistoryMode.Reviewing) {
			this.status = 'history-review';
			return this.status;
		}
		if (this.records.length === this.capacity) {
			this.status = 'full';
			return this.status;
		}
		const domain = this.runtime.machine.cpu.activeCartridgeSlot();
		const image = blua32ToolingImageForDomain(this.sources.currentBlua32Media, domain);
		this.points.clear();
		if (image === null) {
			this.status = 'image-unavailable';
			return this.status;
		}
		const binding = bindFunctionProbe(image, 'cartlib/event_emitter', 'event_emitter.emit', ['event_type', 'emitter_id', 'payload']);
		if (binding.status !== 'bound') {
			this.status = binding.status;
			return this.status;
		}
		for (const point of binding.points) this.points.set(point.pc, point);
		this.domainMask = executionDomainBit(domain);
		this.capture++;
		this.status = 'recording';
		this.changedBinding();
		for (const listener of this.recordingListeners) listener();
		return this.status;
	}

	public stop(status: 'stopped' | 'full' | 'runtime-changed' = 'stopped'): void {
		if (this.status !== 'recording') return;
		this.status = status;
		this.domainMask = 0;
		this.points.clear();
		this.revision++;
		this.changedBinding();
		for (const listener of this.recordingListeners) listener();
	}

	public clear(): void {
		this.captured.length = 0;
		this.revision++;
		this.generation++;
		if (this.status === 'full') this.status = 'stopped';
	}

	/** Only called for an admitted instruction, never a pre-interrupt fence or stopped breakpoint. */
	public observe(domain: ExecutionDomainId, pc: number): void {
		if ((this.domainMask & executionDomainBit(domain)) === 0) return;
		const point = this.points.get(pc);
		if (point === undefined) return;
		const cpu = this.runtime.machine.cpu;
		const frame = cpu.getFrameDepth() - 1;
		const registers = point.registers;
		this.snapshot.begin();
		const event = this.snapshot.read(cpu.readFrameRegister(frame, registers[0]));
		const emitter = this.snapshot.read(cpu.readFrameRegister(frame, registers[1]));
		const payload = this.snapshot.read(cpu.readFrameRegister(frame, registers[2]));
		this.captured.push({
			sequence: this.sequence++, capture: this.capture, domain,
			cycles: this.runtime.machine.scheduler.currentNowCycles(),
			completedTick: this.runtime.frameScheduler.lastTickSequence,
			event, emitter, payload });
		this.revision++;
		if (this.records.length === this.capacity) this.stop('full');
	}
}
