import { LuaRuntimeError } from './luaerrors';
import type { LuaValue } from './luavalue';
import type { LuaSourceRange } from './syntax/lua_ast';

export class LuaEnvironment {
	private readonly parent: LuaEnvironment;
	private readonly values: Map<string, LuaValue>;
	private readonly definitions: Map<string, LuaSourceRange>;

	private constructor(parent: LuaEnvironment) {
		this.parent = parent;
		this.values = new Map<string, LuaValue>();
		this.definitions = new Map<string, LuaSourceRange>();
	}

	public static createRoot(): LuaEnvironment {
		return new LuaEnvironment(null);
	}

	public static createChild(parent: LuaEnvironment): LuaEnvironment {
		return new LuaEnvironment(parent);
	}

	public set(_name: string, value: LuaValue, range?: LuaSourceRange): void {
		const name = _name;
		this.values.set(name, value);
		if (range && !this.definitions.has(name)) {
			this.definitions.set(name, range);
		}
	}

	public assignExisting(_name: string, value: LuaValue): void {
		const name = _name;
		const resolved = this.resolve(name);
		if (resolved === null) {
			throw new LuaRuntimeError(`[LuaEnvironment] Attempted to assign to undefined variable '${name}'.`, '<environment>', 0, 0);
		}
		resolved.values.set(name, value);
	}

	public get(_name: string): LuaValue {
		const name = _name;
		const value = this.values.get(name);
		if (value !== undefined) {
			return value;
		}
		if (this.parent !== null) {
			return this.parent.get(name);
		}
		return null;
	}

	public getDefinition(_name: string): LuaSourceRange {
		const name = _name;
		const local = this.definitions.get(name);
		if (local) {
			return local;
		}
		if (this.parent !== null) {
			return this.parent.getDefinition(name);
		}
		return null;
	}

	public hasLocal(_name: string): boolean {
		const name = _name;
		return this.values.has(name);
	}

	public resolve(_name: string): LuaEnvironment {
		const name = _name;
		if (this.values.has(name)) {
			return this;
		}
		if (this.parent !== null) {
			return this.parent.resolve(name);
		}
		return null;
	}

	public entries(): Array<[string, LuaValue]> {
		return Array.from(this.values.entries());
	}

	public keys(): IterableIterator<string> {
		return this.values.keys();
	}

	public getParent(): LuaEnvironment {
		return this.parent;
	}
}
