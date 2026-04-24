import type { StringHandleTable, StringHandleTableState } from './memory';

export type StringId = number;

export class StringValue {
	public readonly id: StringId;
	public readonly text: string;
	public readonly codepointCount: number;

	private constructor(id: StringId, text: string, codepointCount: number) {
		this.id = id;
		this.text = text;
		this.codepointCount = codepointCount;
	}

	public static create(id: StringId, text: string): StringValue {
		return new StringValue(id, text, countCodepoints(text));
	}
}

export class StringPool {
	private readonly byText = new Map<string, StringValue>();
	private readonly byId: Array<StringValue | null> = [];
	private nextId = 0;
	private readonly handleTable: StringHandleTable | null;

	constructor(handleTable: StringHandleTable | null = null) {
		this.handleTable = handleTable;
	}

	public intern(text: string): StringValue {
		const existing = this.byText.get(text);
		if (existing !== undefined) {
			return existing;
		}
		let id = this.nextId;
		if (this.handleTable) {
			id = this.handleTable.allocateHandle(text).id;
		}
		const entry = StringValue.create(id, text);
		this.byId[id] = entry;
		this.byText.set(text, entry);
		if (id >= this.nextId) {
			this.nextId = id + 1;
		}
		return entry;
	}

	public getById(id: StringId): StringValue {
		const entry = this.byId[id];
		if (!entry) {
			throw new Error(`[StringPool] Unknown string id ${id}.`);
		}
		return entry;
	}

	public codepointCount(value: StringValue): number {
		return value.codepointCount;
	}

	public reserveHandles(minHandle: number): void {
		if (this.handleTable) {
			this.handleTable.reserveHandles(minHandle);
		}
		if (minHandle > this.nextId) {
			for (let index = this.byId.length; index < minHandle; index += 1) {
				this.byId[index] = null;
			}
			this.nextId = minHandle;
		}
	}

	public rehydrateFromHandleTable(state: StringHandleTableState): void {
		if (this.handleTable === null) {
			throw new Error('[StringPool] Cannot rehydrate without a string handle table.');
		}
		this.byText.clear();
		this.byId.length = 0;
		this.nextId = 0;
		for (let id = 0; id < state.nextHandle; id += 1) {
			const entry = this.handleTable.readEntry(id);
			const text = this.handleTable.readText(entry);
			const restored = StringValue.create(id, text);
			this.byId[id] = restored;
			this.byText.set(text, restored);
		}
		this.reserveHandles(state.nextHandle);
		this.nextId = state.nextHandle;
	}
}

export function isStringValue(value: unknown): value is StringValue {
	return value instanceof StringValue;
}

export function stringValueToString(value: StringValue): string {
	return value.text;
}

function countCodepoints(text: string): number {
	let count = 0;
	for (const _char of text) {
		count += 1;
	}
	return count;
}
