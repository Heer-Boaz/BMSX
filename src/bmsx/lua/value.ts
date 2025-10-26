export type LuaValue = LuaNil | boolean | number | string | LuaTable | LuaFunctionValue;

export type LuaNil = null;

export interface LuaFunctionValue {
	readonly name: string;
	call(args: ReadonlyArray<LuaValue>): LuaValue[];
}

export class LuaTable {
	private static caseInsensitiveKeys = true;
	private readonly entries: Map<LuaValue, LuaValue>;
	private readonly numericKeyCache: Map<number, LuaValue>;
	private readonly stringKeyIndex: Map<string, string>;
	private metatable: LuaTable | null;

	constructor() {
		this.entries = new Map<LuaValue, LuaValue>();
		this.numericKeyCache = new Map<number, LuaValue>();
		this.stringKeyIndex = new Map<string, string>();
		this.metatable = null;
	}

	public set(key: LuaValue, value: LuaValue): void {
		if (value === null) {
			this.delete(key);
			return;
		}
		const canonicalKey = this.normalizeKeyForWrite(key);
		this.entries.set(canonicalKey, value);
		if (typeof canonicalKey === 'number') {
			this.numericKeyCache.set(canonicalKey, value);
		}
	}

	public get(key: LuaValue): LuaValue | null {
		const canonicalKey = this.normalizeKeyForRead(key);
		const value = this.entries.get(canonicalKey);
		if (value === undefined) {
			return null;
		}
		return value;
	}

	public delete(key: LuaValue): void {
		const canonicalKey = this.normalizeKeyForDelete(key);
		if (typeof canonicalKey === 'number') {
			this.numericKeyCache.delete(canonicalKey);
		}
		this.entries.delete(canonicalKey);
		if (LuaTable.caseInsensitiveKeys && typeof canonicalKey === 'string') {
			this.stringKeyIndex.delete(canonicalKey.toLowerCase());
		}
	}

	public has(key: LuaValue): boolean {
		const canonicalKey = this.normalizeKeyForRead(key);
		return this.entries.has(canonicalKey);
	}

	public entriesArray(): ReadonlyArray<[LuaValue, LuaValue]> {
		return Array.from(this.entries.entries());
	}

	public numericLength(): number {
		let index = 1;
		while (true) {
			if (!this.numericKeyCache.has(index)) {
				return index - 1;
			}
			index += 1;
		}
	}

	public setMetatable(table: LuaTable | null): void {
		this.metatable = table;
	}

	public getMetatable(): LuaTable | null {
		return this.metatable;
	}

	public static setCaseInsensitiveKeys(enabled: boolean): void {
		LuaTable.caseInsensitiveKeys = enabled;
	}

	public static isCaseInsensitiveKeys(): boolean {
		return LuaTable.caseInsensitiveKeys;
	}

	private normalizeKeyForWrite(key: LuaValue): LuaValue {
		if (typeof key !== 'string') {
			return key;
		}
		if (!LuaTable.caseInsensitiveKeys) {
			return key;
		}
		const normalized = key.toLowerCase();
		const existing = this.stringKeyIndex.get(normalized);
		if (existing !== undefined) {
			return existing;
		}
		this.stringKeyIndex.set(normalized, key);
		return key;
	}

	private normalizeKeyForRead(key: LuaValue): LuaValue {
		if (typeof key !== 'string') {
			return key;
		}
		if (!LuaTable.caseInsensitiveKeys) {
			return key;
		}
		const normalized = key.toLowerCase();
		const existing = this.stringKeyIndex.get(normalized);
		if (existing !== undefined) {
			return existing;
		}
		return key;
	}

	private normalizeKeyForDelete(key: LuaValue): LuaValue {
		if (typeof key !== 'string') {
			return key;
		}
		if (!LuaTable.caseInsensitiveKeys) {
			return key;
		}
		const normalized = key.toLowerCase();
		const existing = this.stringKeyIndex.get(normalized);
		if (existing !== undefined) {
			return existing;
		}
		return key;
	}
}
