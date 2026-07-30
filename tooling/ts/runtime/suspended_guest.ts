import { ScratchBuffer } from '../../../machine/ts/common/scratchbuffer';
import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import type { CPU } from '../../../machine/ts/machine/cpu/cpu';
import type { StringId, StringPool } from '../../../machine/ts/machine/cpu/string_pool';
import {
	TABLE_INDEX_CHAIN_LIMIT,
	type Table,
} from '../../../machine/ts/machine/cpu/table';
import { ValueSlots } from '../../../machine/ts/machine/cpu/value_slots';
import {
	materializeValue,
	EMPTY_CALL_ARGS,
	type Value,
	type ValueReference,
	valueIsTable,
	valueString,
	valueToString,
	valueTag,
	ValueTag,
} from '../../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';

export type SuspendedGuestValue = Value;

export const enum SuspendedGuestValueKind {
	Nil,
	Boolean,
	Number,
	String,
	Table,
	Function,
}

type SuspendedGuestTableMemberVisitor = (
	name: string,
	value: SuspendedGuestValue,
) => void;

const METATABLE_LOOP_MESSAGE = 'Metatable __index loop detected while inspecting suspended guest state.';

export class SuspendedGuestSession {
	private readonly cpu: CPU;
	private readonly stringPool: StringPool;
	private readonly scratch = new ValueSlots(1);
	private readonly entryScratch = new ScratchBuffer<ValueSlots>(() => new ValueSlots(2));
	private readonly previewParts = new ScratchBuffer<string[]>(() => []);
	private readonly previewVisited = new Set<number>();
	private readonly indexKey: StringId;

	public constructor(private readonly runtime: Runtime) {
		this.cpu = runtime.machine.cpu;
		this.stringPool = this.cpu.stringPool;
		this.indexKey = this.stringPool.find('__index')!;
	}

	public global(name: string): SuspendedGuestValue {
		return this.cpu.getGlobalByKey(this.stringPool.find(name)!);
	}

	public systemGlobal(name: string): SuspendedGuestValue {
		return this.cpu.getSystemGlobalByKey(this.stringPool.find(name)!);
	}

	public existingString(value: string): SuspendedGuestValue {
		return valueString(this.stringPool.find(value)!);
	}

	/** The borrowed result view is invalidated by subsequent CPU execution, call entry, reset, or state restore. */
	public callClosure(
		value: SuspendedGuestValue,
		args: ReadonlyArray<SuspendedGuestValue> = EMPTY_CALL_ARGS,
	): ReadonlyArray<SuspendedGuestValue> {
		return this.runtime.callClosure(value as Closure, args);
	}

	public kind(value: SuspendedGuestValue): SuspendedGuestValueKind {
		switch (valueTag(value)) {
			case ValueTag.Nil:
				return SuspendedGuestValueKind.Nil;
			case ValueTag.False:
			case ValueTag.True:
				return SuspendedGuestValueKind.Boolean;
			case ValueTag.Number:
				return SuspendedGuestValueKind.Number;
			case ValueTag.String:
				return SuspendedGuestValueKind.String;
			case ValueTag.Table:
				return SuspendedGuestValueKind.Table;
			case ValueTag.Closure:
			case ValueTag.BuiltinFunction:
				return SuspendedGuestValueKind.Function;
		}
	}

	public formatValue(value: SuspendedGuestValue): string {
		return valueToString(value, this.stringPool);
	}

	public readStringMember(
		value: SuspendedGuestValue,
		name: string,
	): SuspendedGuestValue {
		const key = this.stringPool.find(name);
		if (key == null) {
			return null;
		}
		const table = value as Table;
		if (!table.resolveStringIndex(
			this.indexKey,
			key,
			this.scratch,
			0,
		)) {
			throw new Error(METATABLE_LOOP_MESSAGE);
		}
		const result = this.scratch.get(0);
		this.scratch.setNil(0);
		return result;
	}

	public readStringPath(
		value: SuspendedGuestValue,
		parts: ReadonlyArray<string>,
		startIndex: number,
	): SuspendedGuestValue {
		let current = value;
		for (let index = startIndex; index < parts.length; index += 1) {
			if (!valueIsTable(current)) {
				return null;
			}
			current = this.readStringMember(current, parts[index]);
			if (current == null) {
				return null;
			}
		}
		return current;
	}

	public visitTableStringMembers(
		value: SuspendedGuestValue,
		visitor: SuspendedGuestTableMemberVisitor,
	): void {
		const visitEntry = (
			keyTag: ValueTag,
			keyScalar: number,
			_keyReference: ValueReference,
			entryTag: ValueTag,
			entryScalar: number,
			entryReference: ValueReference,
		): void => {
			if (keyTag === ValueTag.String) {
				visitor(
					this.stringPool.toString(keyScalar),
					materializeValue(entryTag, entryScalar, entryReference),
				);
			}
		};
		let current = value as Table;
		for (let depth = 0; depth < TABLE_INDEX_CHAIN_LIMIT; depth += 1) {
			current.forEachStoredEntry(visitEntry);
			const next = current.metatableIndexTable(this.indexKey);
			if (!next) {
				return;
			}
			current = next;
		}
		throw new Error(METATABLE_LOOP_MESSAGE);
	}

	public previewValue(
		value: SuspendedGuestValue,
		maxDepth: number,
		maxEntries: number,
	): string {
		try {
			return this.previewValueAtDepth(value, 0, maxDepth, maxEntries);
		} finally {
			this.previewVisited.clear();
		}
	}

	private previewValueAtDepth(
		value: SuspendedGuestValue,
		depth: number,
		maxDepth: number,
		maxEntries: number,
	): string {
		if (!valueIsTable(value)) {
			return valueToString(value, this.stringPool);
		}
		const table = value;
		if (depth >= maxDepth || this.previewVisited.has(table.hashId)) {
			return '{…}';
		}
		this.previewVisited.add(table.hashId);
		const parts = this.previewParts.get(depth);
		const entry = this.entryScratch.get(depth);
		parts.length = 0;
		let afterTag = ValueTag.Nil;
		let afterScalar = NaN;
		let afterReference: ValueReference = null;
		let entryCount = 0;
		let hasEntry = table.next(
			afterTag,
			afterScalar,
			afterReference,
			entry,
			0,
		);
		while (hasEntry && entryCount < maxEntries) {
			const keyTag = entry.getTag(0);
			const keyScalar = entry.getScalar(0);
			const keyReference = entry.getReference(0);
			parts.push(
				`${this.previewValueAtDepth(
					materializeValue(keyTag, keyScalar, keyReference),
					depth + 1,
					maxDepth,
					maxEntries,
				)} = ${this.previewValueAtDepth(
					entry.get(1),
					depth + 1,
					maxDepth,
					maxEntries,
				)}`,
			);
			afterTag = keyTag;
			afterScalar = keyScalar;
			afterReference = keyReference;
			entryCount += 1;
			hasEntry = table.next(
				afterTag,
				afterScalar,
				afterReference,
				entry,
				0,
			);
		}
		if (hasEntry) {
			parts.push('…');
		}
		const preview = parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
		parts.length = 0;
		entry.setNil(0);
		entry.setNil(1);
		return preview;
	}
}
