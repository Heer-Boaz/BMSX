import type { StringPool } from '../../machine/ts/machine/cpu/string_pool';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import type { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';

/** Detached data, not UI text or live inspection handles. Also lossless across JSON transport. */
export type ValueSnapshot =
	| { readonly kind: 'nil' }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'number'; readonly value: number | '-0' | 'nan' | 'inf' | '-inf' }
	| { readonly kind: 'string'; readonly value: string; readonly omitted: boolean }
	| { readonly kind: 'table'; readonly id: number; readonly entries: readonly ValueSnapshotEntry[]; readonly omitted: boolean }
	| { readonly kind: 'reference' | 'function' | 'thread'; readonly id: number }
	| { readonly kind: 'builtin'; readonly id: BuiltinFunctionId };
export type ValueSnapshotEntry = { readonly key: ValueSnapshot; readonly value: ValueSnapshot };
export const VALUE_SNAPSHOT_DEPTH = 3;
export const VALUE_SNAPSHOT_ENTRIES = 64;
export const VALUE_SNAPSHOT_CHARACTERS = 4096;
export const VALUE_SNAPSHOT_SLOTS = 1024;
const NO_ENTRIES: readonly ValueSnapshotEntry[] = [];
const NIL: ValueSnapshot = { kind: 'nil' };
const FALSE: ValueSnapshot = { kind: 'boolean', value: false };
const TRUE: ValueSnapshot = { kind: 'boolean', value: true };

/** Bounded stored-value snapshots. Never invokes Lua or retains guest objects/string IDs. */
export class GuestValueSnapshot {
	private readonly visited = new Set<number>();
	private readonly scratch = Array.from({ length: VALUE_SNAPSHOT_DEPTH }, () => new ValueSlots(2));
	private remainingEntries = 0;
	private remainingCharacters = 0;
	private remainingSlots = 0;
	public constructor(private readonly pool: StringPool) {}
	public begin(): void {
		this.visited.clear();
		this.remainingEntries = VALUE_SNAPSHOT_ENTRIES;
		this.remainingCharacters = VALUE_SNAPSHOT_CHARACTERS;
		this.remainingSlots = VALUE_SNAPSHOT_SLOTS;
	}
	public read(values: ValueSlots, index: number, depth = 0): ValueSnapshot {
		const tag = values.getTag(index);
		switch (tag) {
			case ValueTag.Nil: return NIL;
			case ValueTag.False: return FALSE;
			case ValueTag.True: return TRUE;
			case ValueTag.Number: {
				const value = values.getScalar(index);
				// JSON numbers cannot carry these IEEE values. Encode them explicitly,
				// rather than silently turning them into null/zero at the tool boundary.
				if (value - value !== 0) {
					return { kind: 'number', value: value !== value ? 'nan' : value < 0 ? '-inf' : 'inf' };
				}
				return { kind: 'number', value: Object.is(value, -0) ? '-0' : value };
			}
			case ValueTag.String: {
				const text = this.pool.toString(values.getScalar(index));
				const length = Math.min(text.length, this.remainingCharacters);
				this.remainingCharacters -= length;
				return { kind: 'string', value: text.slice(0, length), omitted: length < text.length };
			}
			case ValueTag.Closure: return { kind: 'function', id: values.getReference(index)!.hashId };
			case ValueTag.Thread: return { kind: 'thread', id: values.getReference(index)!.hashId };
			case ValueTag.BuiltinFunction: return { kind: 'builtin', id: values.getScalar(index) };
		}
		const table = values.getReference(index) as Table, id = table.hashId;
		if (this.visited.has(id)) return { kind: 'reference', id };
		if (depth === VALUE_SNAPSHOT_DEPTH) return { kind: 'table', id, entries: NO_ENTRIES, omitted: true };
		this.visited.add(id);
		const entries: ValueSnapshotEntry[] = [], scratch = this.scratch[depth];
		let slot = 0, omitted = false;
		const count = table.storedSlotCount;
		while (slot < count && this.remainingSlots > 0) {
			this.remainingSlots--;
			if (!table.loadStoredEntry(slot++, scratch, 0)) continue;
			if (this.remainingEntries === 0) { omitted = true; break; }
			this.remainingEntries--;
			// Table keys are identities, not a second traversal of the object graph.
			entries.push({ key: this.read(scratch, 0, VALUE_SNAPSHOT_DEPTH), value: this.read(scratch, 1, depth + 1) });
		}
		scratch.clear(2);
		return { kind: 'table', id, entries, omitted: omitted || slot < count };
	}
}

/** Format only when a consumer requests text, never on the emitting guest's path. */
export function formatValueSnapshot(value: ValueSnapshot): string {
	switch (value.kind) {
		case 'nil': return 'nil';
		case 'boolean': case 'number': return String(value.value);
		case 'string': return JSON.stringify(value.value);
		default: return `${value.kind} #${value.id}`;
	}
}
