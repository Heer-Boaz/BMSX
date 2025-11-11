import type { LuaInterpreter } from '../lua/runtime.ts';
import { isLuaDebuggerPauseSignal } from '../lua/runtime.ts';
import type { LuaFunctionValue } from '../lua/value.ts';

export interface LuaHandlerFn extends Function {
	__hid: string;
	__hmod: string;
	__hpath?: string;
	__rebind(fn: LuaFunctionValue, interpreter: LuaInterpreter): void;
}

export type LuaHandlerCallFn = (
	fn: LuaFunctionValue,
	interpreter: LuaInterpreter,
	thisArg: unknown,
	args: ReadonlyArray<unknown>,
) => unknown;

export type LuaHandlerErrorReporter = (
	error: unknown,
	meta: { hid: string; moduleId: string; path?: string },
) => void;

export type LuaHandlerContext = {
	moduleId: string;
	interpreter: LuaInterpreter;
	path?: ReadonlyArray<string>;
};

type HandlerRecord = {
	handler: LuaHandlerFn;
	moduleId: string;
	key: string;
	path?: string;
	current: { fn: LuaFunctionValue; interpreter: LuaInterpreter };
};

export class LuaHandlerCache {
	private readonly byLuaFn = new WeakMap<LuaFunctionValue, LuaHandlerFn>();
	private readonly byHid = new Map<string, HandlerRecord>();
	private readonly byModule = new Map<string, Map<string, HandlerRecord>>();
	private readonly byHandler = new WeakMap<LuaHandlerFn, HandlerRecord>();
	private readonly anonCounters = new Map<string, number>();

	constructor(
		private readonly callLua: LuaHandlerCallFn,
		private readonly reportError: LuaHandlerErrorReporter,
	) {}

	public getOrCreate(fn: LuaFunctionValue, ctx: LuaHandlerContext): LuaHandlerFn {
		const cached = this.byLuaFn.get(fn);
		if (cached) {
			return cached;
		}

		const moduleId = this.normalizeModuleId(ctx.moduleId);
		const key = this.resolveKey(moduleId, ctx.path);
		if (!key) {
			throw new Error(`[LuaHandlerCache] Unable to resolve handler key for module '${moduleId}'.`);
		}
		const hid = this.buildHid(moduleId, key);
		const existing = this.byHid.get(hid);
		if (existing) {
			this.byLuaFn.set(fn, existing.handler);
			existing.current = { fn, interpreter: ctx.interpreter };
			existing.handler.__rebind(fn, ctx.interpreter);
			return existing.handler;
		}

		const pathText = this.pathToText(ctx.path);
		const handler = this.createHandler(hid, moduleId, pathText, fn, ctx.interpreter);
		const record: HandlerRecord = {
			handler,
			moduleId,
			key,
			path: pathText ?? undefined,
			current: { fn, interpreter: ctx.interpreter },
		};
		this.byLuaFn.set(fn, handler);
		this.byHid.set(hid, record);
		this.index(moduleId, key, record);
		this.byHandler.set(handler, record);
		return handler;
	}

	public rebind(moduleId: string, path: ReadonlyArray<string> | undefined, fn: LuaFunctionValue, interpreter: LuaInterpreter): void {
		const normalizedModule = this.normalizeModuleId(moduleId);
		const key = this.resolveKey(normalizedModule, path, { reuseOnly: true });
		if (!key) {
			return;
		}
		const hid = this.buildHid(normalizedModule, key);
		const record = this.byHid.get(hid);
		if (!record) {
			return;
		}
		record.current = { fn, interpreter };
		record.handler.__rebind(fn, interpreter);
		this.byLuaFn.set(fn, record.handler);
	}

	public unwrap(handler: LuaHandlerFn): { fn: LuaFunctionValue; interpreter: LuaInterpreter } | null {
		const record = this.byHandler.get(handler);
		return record ? record.current : null;
	}

	public listByModule(moduleId: string): ReadonlyArray<LuaHandlerFn> {
		const normalizedModule = this.normalizeModuleId(moduleId);
		const bucket = this.byModule.get(normalizedModule);
		if (!bucket) {
			return [];
		}
		return Array.from(bucket.values(), record => record.handler);
	}

	public disposeByModule(moduleId: string): void {
		this.unloadModule(moduleId);
	}

	public unloadModule(moduleId: string): void {
		const normalizedModule = this.normalizeModuleId(moduleId);
		const bucket = this.byModule.get(normalizedModule);
		if (!bucket) {
			return;
		}
		for (const [key, record] of bucket.entries()) {
			this.byHid.delete(this.buildHid(normalizedModule, key));
			this.byHandler.delete(record.handler);
		}
		bucket.clear();
		this.byModule.delete(normalizedModule);
		this.anonCounters.delete(normalizedModule);
	}

	private createHandler(
		hid: string,
		moduleId: string,
		path: string | undefined,
		fn: LuaFunctionValue,
		interpreter: LuaInterpreter,
	): LuaHandlerFn {
		let currentFn = fn;
		let currentInterpreter = interpreter;
		const cache = this;
		const callLua = this.callLua;
		const reportError = this.reportError;

		const handler = function luaHandler(this: unknown, ...args: unknown[]) {
			try {
				return callLua(currentFn, currentInterpreter, this, args);
			} catch (error) {
				if (isLuaDebuggerPauseSignal(error)) {
					throw error;
				}
				reportError(error, { hid, moduleId, path });
				return undefined;
			}
		} as unknown as LuaHandlerFn;

		Object.defineProperties(handler, {
			__hid: { value: hid, enumerable: false, writable: false, configurable: false },
			__hmod: { value: moduleId, enumerable: false, writable: false, configurable: false },
			__hpath: { value: path, enumerable: false, writable: false, configurable: true },
			__rebind: {
				value: (nextFn: LuaFunctionValue, nextInterpreter: LuaInterpreter) => {
					currentFn = nextFn;
					currentInterpreter = nextInterpreter;
					cache.byLuaFn.set(nextFn, handler);
				},
				enumerable: false,
				writable: false,
				configurable: false,
			},
		});

		return handler;
	}

	private resolveKey(moduleId: string, path: ReadonlyArray<string> | undefined, opts?: { reuseOnly?: boolean }): string | null {
		const normalizedPath = this.pathToText(path);
		if (normalizedPath) {
			return normalizedPath;
		}

		if (opts?.reuseOnly) {
			const bucket = this.byModule.get(moduleId);
			if (!bucket) {
				return null;
			}
			for (const [key, record] of bucket.entries()) {
				if (!record.path) {
					return key;
				}
			}
			return null;
		}

		const next = (this.anonCounters.get(moduleId) ?? 0) + 1;
		this.anonCounters.set(moduleId, next);
		return `anon::${next}`;
	}

	private index(moduleId: string, key: string, record: HandlerRecord): void {
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Map<string, HandlerRecord>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.set(key, record);
	}

	private buildHid(moduleId: string, key: string): string {
		return `mod:${moduleId}#${key}`;
	}

	private normalizeModuleId(moduleId: string): string {
		return moduleId.trim();
	}

	private pathToText(path: ReadonlyArray<string> | undefined): string | null {
		if (!path || path.length === 0) {
			return null;
		}
		const segments = path.map(segment => segment?.trim()).filter(segment => segment && segment.length > 0) as string[];
		if (segments.length === 0) {
			return null;
		}
		return segments.join('.');
	}
}

export function isLuaHandlerFn(candidate: unknown): candidate is LuaHandlerFn {
	return typeof candidate === 'function'
		&& Object.prototype.hasOwnProperty.call(candidate, '__hid')
		&& Object.prototype.hasOwnProperty.call(candidate, '__hmod');
}
