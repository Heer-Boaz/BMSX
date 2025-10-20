import { LuaRuntimeError } from './errors.ts';
import type { LuaValue } from './value.ts';

export class LuaEnvironment {
	private readonly parent: LuaEnvironment | null;
	private readonly values: Map<string, LuaValue>;

	private constructor(parent: LuaEnvironment | null) {
		this.parent = parent;
		this.values = new Map<string, LuaValue>();
	}

	public static createRoot(): LuaEnvironment {
		return new LuaEnvironment(null);
	}

	public static createChild(parent: LuaEnvironment): LuaEnvironment {
		return new LuaEnvironment(parent);
	}

	public set(name: string, value: LuaValue): void {
		this.values.set(name, value);
	}

	public assignExisting(name: string, value: LuaValue): void {
		const resolved = this.resolve(name);
		if (resolved === null) {
			throw new LuaRuntimeError(`[LuaEnvironment] Attempted to assign to undefined variable '${name}'.`, '<environment>', 0, 0);
		}
		resolved.values.set(name, value);
	}

	public get(name: string): LuaValue | null {
		const value = this.values.get(name);
		if (value !== undefined) {
			return value;
		}
		if (this.parent !== null) {
			return this.parent.get(name);
		}
		return null;
	}

	public hasLocal(name: string): boolean {
		return this.values.has(name);
	}

	public resolve(name: string): LuaEnvironment | null {
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

	public getParent(): LuaEnvironment | null {
		return this.parent;
	}
}
