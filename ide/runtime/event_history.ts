import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { BuiltinArgsView } from '../../machine/ts/machine/cpu/value_slots';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import type { RuntimeSourceState } from './sources';
import { GuestValueSnapshot, type ValueSnapshot } from './value_snapshot';

export type HistoricalEvent = {
	readonly sequence: number;
	readonly timeline: number;
	readonly domain: ExecutionDomainId;
	readonly cycles: number;
	/** Last completed tick at emission, not a claim that this frame is complete. */
	readonly completedTick: number;
	readonly event: ValueSnapshot;
	readonly emitter: ValueSnapshot;
	readonly payload: ValueSnapshot;
};
export type EventHistoryStatus = 'live' | 'replay' | 'uninstrumented';

/** Workspace-owned recent history. Retention is independent of viewer/tool lifetime. */
export class RuntimeEventHistory {
	private readonly buffer: HistoricalEvent[];
	private readonly snapshot: GuestValueSnapshot;
	public revision = 0;
	public generation = 0;
	public firstSequence = 0;
	public endSequence = 0;
	public expired = 0;
	private timeline = 0;

	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		public readonly capacity = 2048,
	) {
		this.buffer = new Array(capacity);
		this.snapshot = new GuestValueSnapshot(runtime.machine.cpu.stringPool);
		runtime.machine.cpu.setTraceHook((domain, args) => this.observe(domain, args));
	}

	public get count(): number { return this.endSequence - this.firstSequence; }
	public get status(): EventHistoryStatus {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return 'replay';
		const image = blua32ToolingImageForDomain(this.sources.currentBlua32Media, this.runtime.machine.cpu.activeCartridgeSlot());
		return image !== null && image.symbols !== null && image.symbols.metadata.hostTraceChannels.includes('event.emit') ? 'live' : 'uninstrumented';
	}

	/** Sequence must be in the advertised retained window. External cursors are admitted by tools. */
	public at(sequence: number): HistoricalEvent { return this.buffer[sequence % this.capacity]; }

	public clear(): void {
		this.buffer.length = 0;
		this.firstSequence = this.endSequence;
		this.expired = 0;
		this.generation++;
		this.revision++;
	}

	/** Restores/installations do not turn old evidence into events from a new timeline. */
	public beginTimeline(): void { this.timeline++; this.revision++; }

	public dispose(): void { this.runtime.machine.cpu.setTraceHook(null); }

	private observe(domain: ExecutionDomainId, args: BuiltinArgsView): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const cpu = this.runtime.machine.cpu, values = args.registers, base = args.base;
		// The compiler's host-trace transport is (subject, channel, ...values).
		if (cpu.stringPool.toString(values.getScalar(base + 1)) !== 'event.emit') return;
		this.snapshot.begin();
		const event = this.snapshot.read(values.get(base + 2));
		const emitter = this.snapshot.read(values.get(base + 3));
		const payload = this.snapshot.read(values.get(base + 4));
		const sequence = this.endSequence++;
		this.buffer[sequence % this.capacity] = {
			sequence, timeline: this.timeline, domain,
			cycles: this.runtime.machine.scheduler.currentNowCycles(),
			completedTick: this.runtime.frameScheduler.lastTickSequence,
			event, emitter, payload,
		};
		if (this.count > this.capacity) { this.firstSequence++; this.expired++; }
		this.revision++;
	}
}
