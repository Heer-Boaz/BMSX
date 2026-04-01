import { LuaRuntimeError } from './luaerrors';
import type { LuaValue } from './luavalue';
import type { LuaSourceRange } from './syntax/lua_ast';

type BindingRecord = {
	value: LuaValue;
	definition: LuaSourceRange | null;
	isConst: boolean;
};

export class LuaEnvironment {
	private readonly parent: LuaEnvironment;
	private readonly bindings: Map<string, BindingRecord>;

	private constructor(parent: LuaEnvironment, bindings: Map<string, BindingRecord> = new Map<string, BindingRecord>()) {
		this.parent = parent;
		this.bindings = bindings;
	}

	public static createRoot(): LuaEnvironment {
		return new LuaEnvironment(null);
	}

	public static createChild(parent: LuaEnvironment): LuaEnvironment {
		return new LuaEnvironment(parent);
	}

	public snapshot(): LuaEnvironment {
		if (this.parent === null) {
			return this;
		}
		const parentSnapshot = this.parent.parent === null ? this.parent : this.parent.snapshot();
		return new LuaEnvironment(parentSnapshot, new Map(this.bindings));
	}

	private isBindingVisible(binding: BindingRecord, accessRange: LuaSourceRange | null): boolean {
		if (this.parent === null || accessRange === null) {
			return true;
		}
		const definition = binding.definition;
		if (definition === null || definition.path !== accessRange.path) {
			return true;
		}
		if (accessRange.start.line > definition.start.line) {
			return true;
		}
		if (accessRange.start.line < definition.start.line) {
			return false;
		}
		return accessRange.start.column >= definition.start.column;
	}

	public set(_name: string, value: LuaValue, range?: LuaSourceRange, isConst = false): void {
		const name = _name;
		const existing = this.bindings.get(name);
		this.bindings.set(name, {
			value,
			definition: range ?? (existing ? existing.definition : null),
			isConst,
		});
	}

	public assignExisting(_name: string, value: LuaValue, isConst?: boolean): void {
		const name = _name;
		const resolved = this.resolve(name);
		if (resolved === null) {
			throw new LuaRuntimeError(`[LuaEnvironment] Attempted to assign to undefined variable '${name}'.`, '<environment>', 0, 0);
		}
		const binding = resolved.bindings.get(name);
		if (binding.isConst) {
			const range = binding.definition ?? resolved.getDefinition(name);
			throw new LuaRuntimeError(`[LuaEnvironment] Attempted to assign to constant variable '${name}'.`, range?.path ?? '<environment>', range?.start.line ?? 0, range?.start.column ?? 0);
		}
		binding.value = value;
		if (isConst !== undefined) {
			binding.isConst = isConst;
		}
	}

	public get(_name: string, accessRange: LuaSourceRange | null = null): LuaValue {
		const name = _name;
		const binding = this.bindings.get(name);
		if (binding && this.isBindingVisible(binding, accessRange)) {
			return binding.value;
		}
		if (this.parent !== null) {
			return this.parent.get(name, accessRange);
		}
		return null;
	}

	public getDefinition(_name: string): LuaSourceRange {
		const name = _name;
		const local = this.bindings.get(name);
		if (local && local.definition) {
			return local.definition;
		}
		if (this.parent !== null) {
			return this.parent.getDefinition(name);
		}
		return null;
	}

	public hasLocal(_name: string): boolean {
		const name = _name;
		return this.bindings.has(name);
	}

	public resolve(_name: string, accessRange: LuaSourceRange | null = null): LuaEnvironment {
		const name = _name;
		const binding = this.bindings.get(name);
		if (binding && this.isBindingVisible(binding, accessRange)) {
			return this;
		}
		if (this.parent !== null) {
			return this.parent.resolve(name, accessRange);
		}
		return null;
	}

	public entries(): Array<[string, LuaValue]> {
		const entries: Array<[string, LuaValue]> = [];
		for (const [name, binding] of this.bindings.entries()) {
			entries.push([name, binding.value]);
		}
		return entries;
	}

	public keys(): IterableIterator<string> {
		return this.bindings.keys();
	}

	public getParent(): LuaEnvironment {
		return this.parent;
	}
}
