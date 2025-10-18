export type LuaValue = LuaNil | boolean | number | string | LuaTable | LuaFunctionValue;

export type LuaNil = null;

export interface LuaFunctionValue {
	readonly name: string;
	call(args: ReadonlyArray<LuaValue>): LuaValue;
}

export class LuaTable {
	private readonly entries: Map<LuaValue, LuaValue>;

	constructor() {
		this.entries = new Map<LuaValue, LuaValue>();
	}

	public set(key: LuaValue, value: LuaValue): void {
		this.entries.set(key, value);
	}

	public get(key: LuaValue): LuaValue | null {
		const value = this.entries.get(key);
		if (value === undefined) {
			return null;
		}
		return value;
	}

	public delete(key: LuaValue): void {
		this.entries.delete(key);
	}

	public has(key: LuaValue): boolean {
		return this.entries.has(key);
	}
}
