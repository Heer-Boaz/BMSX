import type { CallFrame } from '../../machine/ts/machine/cpu/call_state';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';
import { Blua32GlobalRegisterFile } from './sources';
import type { RuntimeLuaFrameBinding } from './lua_inspection';
import { SuspendedGuestValueKind, type SuspendedGuestSession, type SuspendedGuestValue } from './suspended_guest';

export type InspectedValue = {
	readonly kind: 'nil' | 'boolean' | 'number' | 'string' | 'table' | 'function' | 'thread';
	readonly display: string;
	readonly reference?: string;
};
export type InspectedEntry = {
	readonly key: InspectedValue;
	readonly value: InspectedValue | { readonly kind: 'unavailable'; readonly reason: 'no-live-location'; readonly display: string; readonly reference?: never };
	readonly registerFile?: 'ordinary' | 'system';
	readonly definition?: SourceRange | null;
	/** Present for lexical bindings only; does not make the referenced object immutable. */
	readonly isConst?: boolean;
};
type GlobalBinding = readonly [name: string, registerFile: Blua32GlobalRegisterFile];
type Container =
	| { kind: 'globals'; names: ReadonlyMap<string, Blua32GlobalRegisterFile>; bindings?: readonly GlobalBinding[] }
	| { kind: 'locals' | 'upvalues'; frame: CallFrame; bindings: readonly RuntimeLuaFrameBinding[] }
	| { kind: 'table'; value: SuspendedGuestValue; entries?: readonly (readonly [SuspendedGuestValue, SuspendedGuestValue])[] };
const VALUE_KINDS: Record<SuspendedGuestValueKind, InspectedValue['kind']> = {
	[SuspendedGuestValueKind.Nil]: 'nil', [SuspendedGuestValueKind.Boolean]: 'boolean',
	[SuspendedGuestValueKind.Number]: 'number', [SuspendedGuestValueKind.String]: 'string',
	[SuspendedGuestValueKind.Table]: 'table', [SuspendedGuestValueKind.Function]: 'function',
	[SuspendedGuestValueKind.Thread]: 'thread',
};

/** Borrowed values of one physical suspension. Frame containers bind actual frames, never the active CPU index. */
export class InspectionValues {
	private readonly containers = new Map<string, Container>();
	private readonly tables = new Map<number, string>();
	public constructor(private readonly id: string, private guest: SuspendedGuestSession | undefined) {}

	public globals(names: ReadonlyMap<string, Blua32GlobalRegisterFile>): string {
		return this.add({ kind: 'globals', names });
	}
	public frame(kind: 'locals' | 'upvalues', frame: CallFrame, bindings: readonly RuntimeLuaFrameBinding[]): string {
		return this.add({ kind, frame, bindings });
	}
	private add(container: Container): string {
		const reference = `${this.id}/${this.containers.size}`;
		this.containers.set(reference, container);
		return reference;
	}
	/** Domain readers admit actual roots into the same alias/cycle registry as globals and frames. */
	public describe(value: SuspendedGuestValue): InspectedValue {
		const guest = this.guest!, kind = guest.kind(value), display = guest.formatValue(value);
		if (kind !== SuspendedGuestValueKind.Table) return { kind: VALUE_KINDS[kind], display };
		const identity = (value as Table).hashId;
		let reference = this.tables.get(identity);
		if (reference === undefined) {
			reference = this.add({ kind: 'table', value });
			this.tables.set(identity, reference);
		}
		return { kind: 'table', display, reference };
	}
	public read(reference: string, start: number, count: number) {
		const container = this.containers.get(reference);
		if (container === undefined) throw new Error('Value reference does not belong to this inspection.');
		const guest = this.guest!, entries: InspectedEntry[] = [];
		let total: number;
		if (container.kind === 'globals') {
			if (container.bindings === undefined) container.bindings = Array.from(container.names);
			total = container.bindings.length;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const [name, bank] = container.bindings[index];
				const value = bank === Blua32GlobalRegisterFile.System ? guest.systemGlobal(name) : guest.global(name);
				entries.push({ key: { kind: 'string', display: name }, value: this.describe(value),
					registerFile: bank === Blua32GlobalRegisterFile.System ? 'system' : 'ordinary' });
			}
		} else if (container.kind === 'table') {
			if (container.entries === undefined) {
				const stored: [SuspendedGuestValue, SuspendedGuestValue][] = [];
				guest.visitTableEntries(container.value, (key, value) => stored.push([key, value]));
				container.entries = stored;
			}
			total = container.entries.length;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const [key, value] = container.entries[index];
				entries.push({ key: this.describe(key), value: this.describe(value) });
			}
		} else {
			total = container.bindings.length;
			for (let index = start, end = Math.min(start + count, total); index < end; index++) {
				const binding = container.bindings[index];
				entries.push({ key: { kind: 'string', display: binding.name }, definition: binding.definition, isConst: binding.isConst,
					value: binding.location !== null
						? this.describe(binding.location.inStack ? container.frame.registers.get(binding.location.index)
							: guest.readClosureUpvalue(container.frame.closure, binding.location.index))
						: { kind: 'unavailable', reason: 'no-live-location', display: '<no live location>' } });
			}
		}
		return { inspection: this.id, reference, start, total, entries };
	}
	public dispose(): void { this.containers.clear(); this.tables.clear(); this.guest = undefined; }
}
