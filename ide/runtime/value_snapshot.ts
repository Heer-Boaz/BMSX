import type { StringPool } from '../../machine/ts/machine/cpu/string_pool';
import type { GcHeap } from '../../machine/ts/machine/cpu/gc_heap';
import { f32BitsToNumber } from '../../machine/ts/common/float32';
import { formatInteger, formatFloat } from '../../machine/ts/common/number_format';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import type { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';

/** Detached data, not UI text or live inspection handles. Also lossless across JSON transport. */
export type ValueSnapshot =
	| { readonly kind: 'nil' }
	| { readonly kind: 'boolean'; readonly value: boolean }
	| { readonly kind: 'integer'; readonly value: number }
	| { readonly kind: 'float'; readonly bits: number }
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
	private readonly visited = new Map<number, Extract<ValueSnapshot, { kind: 'table' }>>();
	public get tables(): ReadonlyMap<number, Extract<ValueSnapshot, { kind: 'table' }>> { return this.visited; }
	private readonly scratch = Array.from({ length: VALUE_SNAPSHOT_DEPTH }, () => new ValueSlots(2));
	private readonly textUnits: number[] = [];
	private remainingEntries = 0;
	private remainingCharacters = 0;
	private remainingSlots = 0;
	public constructor(private readonly pool: StringPool, private readonly heap: GcHeap) {}
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
			case ValueTag.Integer: return { kind: 'integer', value: values.getInteger(index) };
			// Raw binary32 words survive JSON, including NaN payload/sign and -0.
			// Decode only for presentation, not on the observed guest's path.
			case ValueTag.Float: return { kind: 'float', bits: values.getPayload(index) };
			case ValueTag.String: {
				const text = this.pool.toString(values.getStringId(index));
				const length = Math.min(text.length, this.remainingCharacters);
				this.remainingCharacters -= length;
				// A substring can retain the entire guest string's backing storage,
				// even after restoring the pool. Own only the budgeted UTF-16 units.
				const units = this.textUnits;
				units.length = length;
				for (let offset = 0; offset < length; offset++) units[offset] = text.charCodeAt(offset);
				return { kind: 'string', value: String.fromCharCode(...units), omitted: length < text.length };
			}
			case ValueTag.Closure: return { kind: 'function', id: values.getClosure(index, this.heap).hashId };
			case ValueTag.Thread: return { kind: 'thread', id: values.getThread(index, this.heap).hashId };
			case ValueTag.BuiltinFunction: return { kind: 'builtin', id: values.getBuiltinFunctionId(index) };
		}
		const table = values.getTable(index, this.heap), id = table.hashId;
		if (this.visited.has(id)) return { kind: 'reference', id };
		if (depth === VALUE_SNAPSHOT_DEPTH) return { kind: 'table', id, entries: NO_ENTRIES, omitted: true };
		const entries: ValueSnapshotEntry[] = [], scratch = this.scratch[depth];
		const snapshot = { kind: 'table' as const, id, entries, omitted: false };
		this.visited.set(id, snapshot);
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
		snapshot.omitted = omitted || slot < count;
		return snapshot;
	}
}

/** Format only when a consumer requests text, never on the emitting guest's path. */
export function formatValueSnapshot(value: ValueSnapshot): string {
	switch (value.kind) {
		case 'nil': return 'nil';
		case 'boolean': return String(value.value);
		case 'integer': return formatInteger(value.value);
		case 'float': return formatFloat(f32BitsToNumber(value.bits));
		case 'string': return JSON.stringify(value.value);
		default: return `${value.kind} #${value.id}`;
	}
}
