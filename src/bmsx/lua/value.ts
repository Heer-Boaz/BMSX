export type LuaValue = LuaNil | boolean | number | string | LuaTable | LuaFunctionValue;

export type LuaNil = null;

export interface LuaFunctionValue {
	readonly name: string;
	call(args: ReadonlyArray<LuaValue>): LuaValue[];
}

export class LuaTable {
	private readonly entries: Map<LuaValue, LuaValue>;
	private readonly numericKeyCache: Map<number, LuaValue>;
	private metatable: LuaTable | null;

	constructor() {
		this.entries = new Map<LuaValue, LuaValue>();
		this.numericKeyCache = new Map<number, LuaValue>();
		this.metatable = null;
	}

	public set(key: LuaValue, value: LuaValue): void {
		if (value === null) {
			this.delete(key);
			return;
		}
		this.entries.set(key, value);
		if (typeof key === 'number') {
			this.numericKeyCache.set(key, value);
		}
	}

	public get(key: LuaValue): LuaValue | null {
		const value = this.entries.get(key);
		if (value === undefined) {
			return null;
		}
		return value;
	}

	public delete(key: LuaValue): void {
		if (typeof key === 'number') {
			this.numericKeyCache.delete(key);
		}
		this.entries.delete(key);
	}

	public has(key: LuaValue): boolean {
		return this.entries.has(key);
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
}
