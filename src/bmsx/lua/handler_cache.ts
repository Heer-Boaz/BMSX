import { isLuaDebuggerPauseSignal } from './value';
import type { LuaFunctionValue } from './value';

export interface LuaHandlerFn extends Function {
	(...args: unknown[]): unknown;
	__hid: string;
	__hmod: string;
	__hpath?: string;
	__rebind(fn: LuaFunctionValue): void;
}

export type LuaHandlerCallFn = (
	fn: LuaFunctionValue,
	thisArg: unknown,
	args: ReadonlyArray<unknown>,
) => unknown;

export type LuaHandlerErrorReporter = (
	error: unknown,
	meta: { hid: string; moduleId: string; path?: string },
) => void;

export type LuaHandlerContext = {
	moduleId: string;
	path?: ReadonlyArray<string>;
};

type HandlerRecord = {
	handler: LuaHandlerFn;
	moduleId: string;
	key: string;
	path?: string;
	current: { fn: LuaFunctionValue };
};

export class LuaHandlerCache {
	private readonly byLuaFn = new WeakMap<LuaFunctionValue, LuaHandlerFn>(); // fn -> handler
	private readonly byHid = new Map<string, HandlerRecord>(); // hid -> record
	private readonly byModule = new Map<string, Map<string, HandlerRecord>>(); // moduleId -> (key -> record)
	private readonly byHandler = new WeakMap<LuaHandlerFn, HandlerRecord>(); // reverse lookup
	private readonly anonCounters = new Map<string, number>(); // moduleId -> next anon counter

	constructor(
		private readonly callLua: LuaHandlerCallFn,
		private readonly reportError: LuaHandlerErrorReporter,
	) {}

	public getOrCreate(fn: LuaFunctionValue, ctx: LuaHandlerContext): LuaHandlerFn {
		const cached = this.byLuaFn.get(fn);
		if (cached) {
			return cached;
		}

		const moduleId = ctx.moduleId;
		const key = this.resolveKey(moduleId, ctx.path);
		if (!key) {
			throw new Error(`[LuaHandlerCache] Unable to resolve handler key for module '${moduleId}'.`);
		}
		const hid = this.buildHid(moduleId, key);
		const existing = this.byHid.get(hid);
		if (existing) {
			this.byLuaFn.set(fn, existing.handler);
			existing.current = { fn };
			existing.handler.__rebind(fn);
			return existing.handler;
		}

		const pathText = this.pathToText(ctx.path);
		const handler = this.createHandler(hid, moduleId, pathText, fn);
		const record: HandlerRecord = {
			handler,
			moduleId,
			key,
			path: pathText ,
			current: { fn },
		};
		this.byLuaFn.set(fn, handler);
		this.byHid.set(hid, record);
		this.index(moduleId, key, record);
		this.byHandler.set(handler, record);
		return handler;
	}

	public rebind(moduleId: string, path: ReadonlyArray<string>, fn: LuaFunctionValue): void {
		const key = this.resolveKey(moduleId, path, { reuseOnly: true });
		if (!key) {
			return;
		}
		const hid = this.buildHid(moduleId, key);
		const record = this.byHid.get(hid);
		if (!record) {
			return;
		}
		record.current = { fn };
		record.handler.__rebind(fn);
		this.byLuaFn.set(fn, record.handler);
	}

	public unwrap(handler: LuaHandlerFn): { fn: LuaFunctionValue } {
		const record = this.byHandler.get(handler);
		return record ? record.current : null;
	}

	public listByModule(moduleId: string): ReadonlyArray<LuaHandlerFn> {
		const bucket = this.byModule.get(moduleId);
		if (!bucket) {
			return [];
		}
		return Array.from(bucket.values(), record => record.handler);
	}

	public disposeByModule(moduleId: string): void {
		this.unloadModule(moduleId);
	}

	public unloadModule(moduleId: string): void {
		const bucket = this.byModule.get(moduleId);
		if (!bucket) {
			return;
		}
		for (const [key, record] of bucket.entries()) {
			this.byHid.delete(this.buildHid(moduleId, key));
			this.byHandler.delete(record.handler);
		}
		bucket.clear();
		this.byModule.delete(moduleId);
		this.anonCounters.delete(moduleId);
	}

	private createHandler(
		hid: string,
		moduleId: string,
		path: string,
		fn: LuaFunctionValue,
	): LuaHandlerFn {
		let currentFn = fn;
		const cache = this;
		const callLua = this.callLua;
		const reportError = this.reportError;

		const handler = function luaHandler(this: unknown, ...args: unknown[]) {
			try {
				return callLua(currentFn, this, args);
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
				value: (nextFn: LuaFunctionValue) => {
					currentFn = nextFn;
					cache.byLuaFn.set(nextFn, handler);
				},
				enumerable: false,
				writable: false,
				configurable: false,
			},
		});

		return handler;
	}

	private resolveKey(moduleId: string, path: ReadonlyArray<string>, opts?: { reuseOnly?: boolean }): string {
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

	private pathToText(path: ReadonlyArray<string>): string {
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

export function isLuaHandlerFunction(candidate: unknown): candidate is LuaHandlerFn {
	return typeof candidate === 'function'
		&& Object.prototype.hasOwnProperty.call(candidate, '__hid')
		&& Object.prototype.hasOwnProperty.call(candidate, '__hmod');
}
