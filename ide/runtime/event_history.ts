import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';
import type { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { blua32ToolingImageForDomain, type Blua32ToolingMedia } from '../../toolchain/ts/rompack/blua32_media';
import { bindFunctionProbe, type FunctionProbeBinding } from './function_probe';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
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
export type EventHistoryStatus = 'live' | 'replay' | Exclude<FunctionProbeBinding['status'], 'bound'>;

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
	private media: Blua32ToolingMedia | null = null;
	private readonly bindings: FunctionProbeBinding[] = [];
	private readonly locations = [new Map<number, readonly number[]>(), new Map<number, readonly number[]>(), new Map<number, readonly number[]>()];

	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		public readonly capacity = 2048,
	) {
		this.buffer = new Array(capacity);
		this.snapshot = new GuestValueSnapshot(runtime.machine.cpu.stringPool);
		this.bindSources();
	}

	public get count(): number { return this.endSequence - this.firstSequence; }
	public get status(): EventHistoryStatus {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return 'replay';
		const binding = this.bindings[this.runtime.machine.cpu.activeCartridgeSlot() + 1];
		return binding.status === 'bound' ? 'live' : binding.status;
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

	/** A physical reset or admitted program installation separates subsequent evidence. */
	public beginTimeline(): void {
		this.bindSources();
		this.timeline++;
		this.revision++;
	}

	public didRestore(origin: RuntimeRestoreOrigin): void {
		if (origin !== RuntimeRestoreOrigin.HistorySeek) this.beginTimeline();
	}

	public dispose(): void { this.runtime.machine.cpu.setInstructionObserver(null); }

	private bindSources(): void {
		if (this.media === this.sources.currentBlua32Media) return;
		this.media = this.sources.currentBlua32Media;
		const points: [Set<number>, Set<number>, Set<number>] = [new Set(), new Set(), new Set()];
		for (const domain of [-1, 0, 1] as const) {
			const index = domain + 1, image = blua32ToolingImageForDomain(this.media, domain);
			const binding = image === null ? { status: 'symbols-unavailable' } as const
				: bindFunctionProbe(image, 'cartlib/event_emitter', 'event_emitter.emit', ['event_type', 'emitter_id', 'payload']);
			this.bindings[index] = binding;
			const locations = this.locations[index];
			locations.clear();
			if (binding.status !== 'bound') continue;
			for (const point of binding.points) {
				points[index].add(point.pc);
				locations.set(point.pc, point.registers);
			}
		}
		this.runtime.machine.cpu.setInstructionObserver({ points, observe: (domain, pc, values) => this.observe(domain, pc, values) });
	}

	private observe(domain: ExecutionDomainId, pc: number, values: ValueSlots): void {
		const mode = this.runtime.history.mode;
		if (mode === HistoryMode.Replaying || mode === HistoryMode.Reviewing) return;
		const locations = this.locations[domain + 1].get(pc)!;
		this.snapshot.begin();
		const event = this.snapshot.read(values, locations[0]);
		const emitter = this.snapshot.read(values, locations[1]);
		const payload = this.snapshot.read(values, locations[2]);
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
