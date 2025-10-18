import type { LuaValue } from './value';

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
		if (this.values.has(name)) {
			this.values.set(name, value);
			return;
		}
		if (this.parent !== null) {
			this.parent.assignExisting(name, value);
			return;
		}
		throw new Error(`[LuaEnvironment] Attempted to assign to undefined global '${name}'.`);
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
}
