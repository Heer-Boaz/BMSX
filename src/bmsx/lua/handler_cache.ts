import type { LuaInterpreter } from '../lua/runtime.ts';
import type { LuaFunctionValue } from '../lua/value.ts';

export interface LuaHandlerFn extends Function {
	__hid: string;
	__hmod: string;
	__hpath?: string;
	__rebind(ref: { fn: LuaFunctionValue; interpreter: LuaInterpreter }): void;
}

export type LuaHandlerCallFn = (fn: LuaFunctionValue, interpreter: LuaInterpreter, thisArg: unknown, args: ReadonlyArray<unknown>) => unknown;
export type LuaHandlerErrorReporter = (error: unknown, meta: { hid: string; moduleId: string; path?: string }) => void;

export type LuaHandlerContext = {
	moduleId: string;
	path?: string | null;
	interpreter: LuaInterpreter;
};

type HandlerRecord = {
	fn: LuaHandlerFn;
	meta: { moduleId: string; key: string; path?: string };
	current: { fn: LuaFunctionValue; interpreter: LuaInterpreter };
};

export class LuaHandlerCache {
	private readonly byLuaFn = new WeakMap<LuaFunctionValue, LuaHandlerFn>();
	private readonly byHid = new Map<string, HandlerRecord>();
	private readonly byModule = new Map<string, Map<string, HandlerRecord>>();
	private readonly anonCounters = new Map<string, number>();
	private readonly byHandler = new WeakMap<LuaHandlerFn, HandlerRecord>();

	constructor(
		private readonly callLua: LuaHandlerCallFn,
		private readonly reportError: LuaHandlerErrorReporter,
	) {}

	public getOrCreate(fn: LuaFunctionValue, ctx: LuaHandlerContext): LuaHandlerFn {
		const cached = this.byLuaFn.get(fn);
		if (cached) {
			return cached;
		}
		const moduleId = ctx.moduleId.trim();
		const key = this.resolveKey(moduleId, ctx.path);
		const hid = this.buildHid(moduleId, key);
		const record = this.byHid.get(hid);
		if (record) {
			this.byLuaFn.set(fn, record.fn);
			record.current = { fn, interpreter: ctx.interpreter };
			record.fn.__rebind({ fn, interpreter: ctx.interpreter });
			return record.fn;
		}

		const handler = this.createHandler(hid, moduleId, ctx, fn);
		const meta = { moduleId, key, path: this.normalizePath(ctx.path) };
		const created: HandlerRecord = {
			fn: handler,
			meta,
			current: { fn, interpreter: ctx.interpreter },
		};
		this.byLuaFn.set(fn, handler);
		this.byHid.set(hid, created);
		this.index(moduleId, key, created);
		this.byHandler.set(handler, created);
		return handler;
	}

	public get(hid: string): LuaHandlerFn | undefined {
		return this.byHid.get(hid)?.fn;
	}

	public rebind(hid: string, fn: LuaFunctionValue, interpreter: LuaInterpreter): void {
		const record = this.byHid.get(hid);
		if (!record) {
			return;
		}
		record.current = { fn, interpreter };
		this.byLuaFn.set(fn, record.fn);
		record.fn.__rebind({ fn, interpreter });
	}

	public unwrap(handler: LuaHandlerFn): { fn: LuaFunctionValue; interpreter: LuaInterpreter } | null {
		const record = this.byHandler.get(handler);
		return record ? record.current : null;
	}

	public listByModule(moduleId: string): ReadonlyArray<LuaHandlerFn> {
		const bucket = this.byModule.get(moduleId.trim());
		if (!bucket) {
			return [];
		}
		return Array.from(bucket.values(), record => record.fn);
	}

	public disposeByModule(moduleId: string): void {
		const normalized = moduleId.trim();
		const bucket = this.byModule.get(normalized);
		if (!bucket) {
			return;
		}
		for (const record of bucket.values()) {
			this.byHid.delete(this.buildHid(normalized, record.meta.key));
			this.byHandler.delete(record.fn);
		}
		bucket.clear();
		this.byModule.delete(normalized);
	}

	private createHandler(
		hid: string,
		moduleId: string,
		ctx: LuaHandlerContext,
		fn: LuaFunctionValue,
	): LuaHandlerFn {
		let currentFn = fn;
		let currentInterpreter = ctx.interpreter;
		const path = this.normalizePath(ctx.path);
		const cache = this;
		const callLua = this.callLua;
		const reportError = this.reportError;

		const handler = function luaHandler(this: unknown, ...args: unknown[]) {
			try {
				return callLua(currentFn, currentInterpreter, this, args);
			} catch (error) {
				reportError(error, { hid, moduleId, path });
				return undefined;
			}
		} as unknown as LuaHandlerFn;

		Object.defineProperties(handler, {
			__hid: { value: hid, enumerable: false, writable: false, configurable: false },
			__hmod: { value: moduleId, enumerable: false, writable: false, configurable: false },
			__hpath: { value: path, enumerable: false, writable: false, configurable: true },
			__rebind: {
				value: ({ fn: nextFn, interpreter }: { fn: LuaFunctionValue; interpreter: LuaInterpreter }) => {
					currentFn = nextFn;
					currentInterpreter = interpreter;
					cache.byLuaFn.set(nextFn, handler);
				},
				enumerable: false,
				writable: false,
				configurable: false,
			},
		});

		return handler;
	}

	private resolveKey(moduleId: string, path: string | null | undefined): string {
		const normalizedPath = this.normalizePath(path);
		if (normalizedPath) {
			return normalizedPath;
		}
		const counter = (this.anonCounters.get(moduleId) ?? 0) + 1;
		this.anonCounters.set(moduleId, counter);
		return `anon::${counter}`;
	}

	private index(moduleId: string, key: string, record: HandlerRecord): void {
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Map<string, HandlerRecord>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.set(key, record);
	}

	private normalizePath(path: string | null | undefined): string | undefined {
		if (!path) {
			return undefined;
		}
		const trimmed = path.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}

	private buildHid(moduleId: string, key: string): string {
		return `mod:${moduleId}#${key}`;
	}
}

export function isLuaHandlerFn(candidate: unknown): candidate is LuaHandlerFn {
	return typeof candidate === 'function'
		&& Object.prototype.hasOwnProperty.call(candidate, '__hid')
		&& Object.prototype.hasOwnProperty.call(candidate, '__hmod');
}
