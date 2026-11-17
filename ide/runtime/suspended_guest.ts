import { ScratchBuffer } from '../../machine/ts/common/scratchbuffer';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import type { StringId, StringPool } from '../../machine/ts/machine/cpu/string_pool';
import {
	TABLE_INDEX_CHAIN_LIMIT,
	TableLookupStatus,
	type TableLookupResult,
} from '../../machine/ts/machine/cpu/table';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import {
	EMPTY_CALL_ARGS,
	type Value,
	asInteger,
	asStringId,
	asTable,
	asClosure,
	isTruthy,
	valueNil,
	valuePayload,
	valueIsTable,
	valueToString,
	valueTag,
	ValueTag,
} from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';

export type SuspendedGuestValue = Value;
/** Owned semantic identity within one physical heap; StringIds are collectible intern slots. */
export type SuspendedValueIdentity =
	| { readonly tag: ValueTag.String; readonly scalar: string }
	| { readonly tag: Exclude<ValueTag, ValueTag.String>; readonly scalar: number };
type LinkedRuntimeFunctionLocation = { readonly domain: ExecutionDomainId; readonly address: number };
export type RuntimeFunctionLocationBuffer = { domain: ExecutionDomainId | null; address: number };
/** RAM functions have a shared address, not a ROM socket or linked symbols. */
export type RuntimeFunctionLocation = LinkedRuntimeFunctionLocation | { readonly domain: null; readonly address: number };
export const STORED_ENTRIES_PREVIEW_LIMIT = 8;
/** History restores retain snapshot identities, never borrowed guest objects or tool handles. */
export type GuestInvalidationReason = 'execution' | 'history-restored' | 'heap-replaced';

export type SuspendedGuestRead = {
	readonly kind: 'value';
	/** Borrowed for this read, not retained across execution or restore. */
	readonly value: SuspendedGuestValue;
} | {
	readonly kind: 'unavailable';
	readonly reason: 'not_a_table';
};

const NOT_A_TABLE: SuspendedGuestRead = { kind: 'unavailable', reason: 'not_a_table' };

export const enum SuspendedGuestValueKind {
	Nil,
	Boolean,
	Integer,
	Float,
	String,
	Table,
	Function,
	Thread,
}

type SuspendedGuestTableMemberVisitor = (
	name: string,
	value: SuspendedGuestValue,
) => void;

const METATABLE_LOOP_MESSAGE = 'Metatable __index loop detected while inspecting suspended guest state.';

export class SuspendedGuestSession {
	/** Borrowed Values are decoded only through this physical CPU's heap. */
	public readonly cpu: CPU;
	private readonly stringPool: StringPool;
	private readonly scratch = new ValueSlots(1);
	private readonly lookupResult: TableLookupResult = {
		values: this.scratch, slot: -1, extraVisits: 0, status: TableLookupStatus.Resolved,
	};
	private readonly entryScratch = new ScratchBuffer<ValueSlots>(() => new ValueSlots(2));
	private readonly previewParts = new ScratchBuffer<string[]>(() => []);
	private readonly previewVisited = new Set<number>();
	private readonly storedParts: string[] = [];
	private readonly formatStoredEntry = (key: Value, entry: Value): void => {
		this.storedParts.push(`${this.formatValue(key)}: ${this.previewValue(entry, 1, STORED_ENTRIES_PREVIEW_LIMIT)}`);
	};
	private readonly indexKey: StringId;
	private readonly invalidationListeners = new Set<(reason: GuestInvalidationReason) => void>();
	private readonly historyReviewEndListeners = new Set<() => void>();

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

	/** Decode semantic String data, without invoking value presentation. */
	public stringText(value: Value): string {
		return this.stringPool.toString(asStringId(value));
	}

	/** UI borrowers end before execution and when restore replaces the inspected heap. */
	public onDidInvalidate(listener: (reason: GuestInvalidationReason) => void): () => void {
		this.invalidationListeners.add(listener);
		return () => this.invalidationListeners.delete(listener);
	}

	public invalidate(reason: GuestInvalidationReason = 'execution'): void {
		for (const listener of this.invalidationListeners) listener(reason);
	}

	/** The history owner ends review before takeover or discard; replay invalidation alone never does. */
	public onWillEndHistoryReview(listener: () => void): () => void {
		this.historyReviewEndListeners.add(listener);
		return () => this.historyReviewEndListeners.delete(listener);
	}

	public willEndHistoryReview(): void {
		for (const listener of this.historyReviewEndListeners) listener();
	}

	public identity(value: Value): SuspendedValueIdentity {
		const tag = valueTag(value);
		return tag === ValueTag.String
			? { tag, scalar: this.stringText(value) }
			: { tag, scalar: this.identityScalar(value, tag) };
	}
	public matchesIdentity(value: Value, identity: SuspendedValueIdentity): boolean {
		return valueTag(value) === identity.tag && this.identityScalar(value, identity.tag) === identity.scalar;
	}
	/** Strings retain immutable text, references their hash identity; never retains a guest reference. */
	public identityScalar(value: Value, tag: Exclude<ValueTag, ValueTag.String>): number;
	public identityScalar(value: Value, tag: ValueTag): number | string;
	public identityScalar(value: Value, tag: ValueTag): number | string {
		switch (tag) {
			case ValueTag.Nil: case ValueTag.False: case ValueTag.True: return 0;
			case ValueTag.Integer: return asInteger(value);
			case ValueTag.Float: case ValueTag.BuiltinFunction: return valuePayload(value);
			case ValueTag.String: return this.stringPool.toString(asStringId(value));
			case ValueTag.Table: case ValueTag.Closure: case ValueTag.Thread: return this.cpu.gc.object(valuePayload(value)).hashId;
			default: throw new Error('Internal table metadata is not a language value.');
		}
	}

	/** The borrowed result view is invalidated by subsequent CPU execution, call entry, reset, or state restore. */
	public callClosure(
		value: SuspendedGuestValue,
		args: ReadonlyArray<SuspendedGuestValue> = EMPTY_CALL_ARGS,
	): ReadonlyArray<SuspendedGuestValue> {
		this.invalidate();
		return this.runtime.callClosure(asClosure(value, this.cpu.gc), args);
	}

	public kind(value: SuspendedGuestValue): SuspendedGuestValueKind {
		switch (valueTag(value)) {
			case ValueTag.Nil:
				return SuspendedGuestValueKind.Nil;
			case ValueTag.False:
			case ValueTag.True:
				return SuspendedGuestValueKind.Boolean;
			case ValueTag.Integer:
				return SuspendedGuestValueKind.Integer;
			case ValueTag.Float:
				return SuspendedGuestValueKind.Float;
			case ValueTag.String:
				return SuspendedGuestValueKind.String;
			case ValueTag.Thread:
				return SuspendedGuestValueKind.Thread;
			case ValueTag.Table:
				return SuspendedGuestValueKind.Table;
			case ValueTag.Closure:
			case ValueTag.BuiltinFunction:
				return SuspendedGuestValueKind.Function;
			default: throw new Error('Internal table metadata is not a language value.');
		}
	}

	public formatValue(value: SuspendedGuestValue): string {
		return valueToString(value, this.stringPool);
	}

	/** Stored keys and holes are preserved; nested entries use the bounded debugger preview. */
	public formatStoredEntries(value: SuspendedGuestValue): string {
		if (!valueIsTable(value)) return this.formatValue(value);
		this.storedParts.length = 0;
		this.visitTableEntries(value, this.formatStoredEntry);
		const text = this.storedParts.length === 0 ? '{}' : this.storedParts.join('\n');
		this.storedParts.length = 0;
		return text;
	}

	/** Same guest predicate as ValueSlots.isTruthy: only nil and false are false. */
	public isTruthy(value: SuspendedGuestValue): boolean {
		return isTruthy(value);
	}

	/** A closure carries the execution domain in which its function record was bound. */
	public functionLocation(value: SuspendedGuestValue, target?: RuntimeFunctionLocationBuffer): RuntimeFunctionLocation | undefined {
		if (valueTag(value) !== ValueTag.Closure) return undefined;
		const closure = asClosure(value, this.cpu.gc);
		const address = closure.functionAddress;
		const domain = closure.executionDomainId;
		if (target === undefined) return { domain, address };
		target.domain = domain; target.address = address;
		return target;
	}

	public linkedFunctionLocation(value: SuspendedGuestValue): LinkedRuntimeFunctionLocation | undefined {
		const location = this.functionLocation(value);
		if (location !== undefined && location.domain !== null) return location;
	}

	public readStringMember(
		value: SuspendedGuestValue,
		name: string,
	): SuspendedGuestValue {
		const key = this.stringPool.find(name);
		if (key == null) {
			return valueNil();
		}
		const table = asTable(value, this.cpu.gc);
		table.resolveStringIndex(this.indexKey, key, this.lookupResult);
		if (this.lookupResult.status === TableLookupStatus.ChainExhausted) {
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
	): SuspendedGuestRead {
		let current = value;
		for (let index = startIndex; index < parts.length; index += 1) {
			if (!valueIsTable(current)) {
				return NOT_A_TABLE;
			}
			current = this.readStringMember(current, parts[index]);
		}
		return { kind: 'value', value: current };
	}

	/** Stored entries only: numeric/boolean/reference keys are not stringified into lookup keys. */
	public visitTableEntries(value: SuspendedGuestValue, visitor: (key: SuspendedGuestValue, value: SuspendedGuestValue) => void): void {
		asTable(value, this.cpu.gc).forEachStoredEntry(visitor);
	}

	public visitTableStringMembers(
		value: SuspendedGuestValue,
		visitor: SuspendedGuestTableMemberVisitor,
	): void {
		const seen = new Set<StringId>();
		const visitEntry = (key: Value, entry: Value): void => {
			if (valueTag(key) !== ValueTag.String) return;
			const id = asStringId(key);
			if (!seen.has(id)) {
				// Lua lookup stops at the first stored value, including false and
				// non-callable shadows. Consumers filter the resolved members only.
				seen.add(id);
				visitor(this.stringPool.toString(id), entry);
			}
		};
		let current = asTable(value, this.cpu.gc);
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
			for (let depth = 0; depth < this.entryScratch.size; depth++) this.entryScratch.peek(depth).clear(2);
			this.entryScratch.clear();
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
		const table = asTable(value, this.cpu.gc);
		if (depth >= maxDepth || this.previewVisited.has(table.hashId)) {
			return '{…}';
		}
		this.previewVisited.add(table.hashId);
		const parts = this.previewParts.get(depth);
		const entry = this.entryScratch.get(depth);
		parts.length = 0;
		let entryCount = 0;
		table.next(valueNil(), entry, 0);
		while (entry.getTag(0) !== ValueTag.Nil && entryCount < maxEntries) {
			const key = entry.get(0);
			parts.push(
				`${this.previewValueAtDepth(
					key,
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
			entryCount += 1;
			table.next(key, entry, 0);
		}
		if (entry.getTag(0) !== ValueTag.Nil) {
			parts.push('…');
		}
		const preview = parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
		parts.length = 0;
		entry.setNil(0);
		entry.setNil(1);
		return preview;
	}
}
