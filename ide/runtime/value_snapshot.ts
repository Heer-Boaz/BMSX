import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { StringPool } from '../../machine/ts/machine/cpu/string_pool';
import type { Table } from '../../machine/ts/machine/cpu/table';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { valueTag, valueToString, ValueTag, type BuiltinFunction, type StringValue, type Value } from '../../machine/ts/machine/cpu/value';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';

export type ValueSnapshot = {
	readonly display: string;
	readonly entries: readonly { readonly key: ValueSnapshot; readonly value: ValueSnapshot }[];
	readonly omitted: boolean;
};
export const VALUE_SNAPSHOT_DEPTH = 3;
export const VALUE_SNAPSHOT_ENTRIES = 64;
export const VALUE_SNAPSHOT_CHARACTERS = 4096;
const NO_ENTRIES: ValueSnapshot['entries'] = [];

/** Bounded, immutable stored-value snapshots. Never invokes Lua or retains guest objects/string IDs. */
export class GuestValueSnapshot {
	private readonly visited = new Set<number>();
	private readonly scratch = Array.from({ length: VALUE_SNAPSHOT_DEPTH }, () => new ValueSlots(2));
	private remainingEntries = 0;
	private remainingCharacters = 0;
	public constructor(private readonly pool: StringPool) {}
	public begin(): void {
		this.visited.clear();
		this.remainingEntries = VALUE_SNAPSHOT_ENTRIES;
		this.remainingCharacters = VALUE_SNAPSHOT_CHARACTERS;
	}
	public read(value: Value, depth = 0): ValueSnapshot {
		const tag = valueTag(value);
		if (tag === ValueTag.String) {
			const text = this.pool.toString((value as StringValue).id);
			const length = Math.min(text.length, this.remainingCharacters);
			this.remainingCharacters -= length;
			return { display: JSON.stringify(text.slice(0, length)), entries: NO_ENTRIES, omitted: length < text.length };
		}
		if (tag !== ValueTag.Table) return { display: tag === ValueTag.Closure || tag === ValueTag.Thread
			? `${valueToString(value, this.pool)} #${(value as Closure | Thread).hashId}`
			: tag === ValueTag.BuiltinFunction ? `builtin #${(value as BuiltinFunction).id}` : valueToString(value, this.pool), entries: NO_ENTRIES, omitted: false };
		const table = value as Table, id = table.hashId;
		if (this.visited.has(id)) return { display: `reference #${id}`, entries: NO_ENTRIES, omitted: false };
		if (depth === VALUE_SNAPSHOT_DEPTH) return { display: `table #${id}`, entries: NO_ENTRIES, omitted: true };
		this.visited.add(id);
		const entries: { key: ValueSnapshot; value: ValueSnapshot }[] = [], scratch = this.scratch[depth];
		let more = table.next(ValueTag.Nil, 0, null, scratch, 0);
		while (more && this.remainingEntries > 0) {
			this.remainingEntries--;
			// Table keys are identities, not a second traversal of the object graph.
			entries.push({ key: this.read(scratch.get(0), VALUE_SNAPSHOT_DEPTH), value: this.read(scratch.get(1), depth + 1) });
			more = table.next(scratch.getTag(0), scratch.getScalar(0), scratch.getReference(0), scratch, 0);
		}
		scratch.clear(2);
		return { display: `table #${id}`, entries, omitted: more };
	}
}
