import type { Closure } from './cpu';

export interface HandlerFn extends Function {
	(...args: unknown[]): unknown;
	__hid: string;
	__hmod: string;
	__hpath?: string;
	__rebind(fn: Closure): void;
}

export type HandlerCallFn = (
	fn: Closure,
	thisArg: unknown,
	args: ReadonlyArray<unknown>,
) => unknown;

export type HandlerErrorReporter = (
	error: unknown,
	meta: { hid: string; moduleId: string; path?: string },
) => void;

type HandlerRecord = {
	handler: HandlerFn;
	moduleId: string;
	key: string;
	path?: string;
	current: { fn: Closure };
};

export class HandlerCache {
	private readonly byClosure = new WeakMap<Closure, HandlerFn>();
	private readonly byHid = new Map<string, HandlerRecord>();
	private readonly byModule = new Map<string, Map<string, HandlerRecord>>();
	private readonly byHandler = new WeakMap<HandlerFn, HandlerRecord>();
	private readonly anonCounters = new Map<string, number>();

	constructor(
		private readonly callClosure: HandlerCallFn,
		private readonly reportError: HandlerErrorReporter,
	) {}

	public getOrCreate(fn: Closure, ctx: { moduleId: string; path?: ReadonlyArray<string> }): HandlerFn {
		const cached = this.byClosure.get(fn);
		if (cached) {
			return cached;
		}

		const moduleId = this.normalizeModuleId(ctx.moduleId);
		const pathText = this.pathToText(ctx.path);
		const key = this.resolveKey(moduleId, ctx.path);
		if (!key) {
			throw new Error(`[HandlerCache] Unable to resolve handler key for module '${moduleId}'.`);
		}
		const hid = this.buildHid(moduleId, key);
		const existing = this.byHid.get(hid);
		if (existing) {
			this.byClosure.set(fn, existing.handler);
			existing.current = { fn };
			existing.handler.__rebind(fn);
			return existing.handler;
		}

		const handler = this.createHandler(hid, moduleId, pathText, fn);
		const record: HandlerRecord = {
			handler,
			moduleId,
			key,
			path: pathText,
			current: { fn },
		};
		this.byClosure.set(fn, handler);
		this.byHid.set(hid, record);
		this.index(moduleId, key, record);
		this.byHandler.set(handler, record);
		return handler;
	}

	public rebind(moduleId: string, path: ReadonlyArray<string>, fn: Closure): void {
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
		record.current = { fn };
		record.handler.__rebind(fn);
		this.byClosure.set(fn, record.handler);
	}

	public unwrap(handler: HandlerFn): { fn: Closure } {
		const record = this.byHandler.get(handler);
		return record ? record.current : null;
	}

	public listByModule(moduleId: string): ReadonlyArray<HandlerFn> {
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
		path: string,
		fn: Closure,
	): HandlerFn {
		let currentFn = fn;
		const cache = this;
		const callClosure = this.callClosure;
		const reportError = this.reportError;

		const handler = function handler(this: unknown, ...args: unknown[]) {
			try {
				return callClosure(currentFn, this, args);
			} catch (error) {
				reportError(error, { hid, moduleId, path });
				return undefined;
			}
		} as unknown as HandlerFn;

		Object.defineProperties(handler, {
			__hid: { value: hid, enumerable: false, writable: false, configurable: false },
			__hmod: { value: moduleId, enumerable: false, writable: false, configurable: false },
			__hpath: { value: path, enumerable: false, writable: false, configurable: true },
			__rebind: {
				value: (nextFn: Closure) => {
					currentFn = nextFn;
					cache.byClosure.set(nextFn, handler);
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

	private normalizeModuleId(moduleId: string): string {
		if (!moduleId || moduleId.length === 0) {
			return 'unknown';
		}
		return moduleId;
	}

	private pathToText(path: ReadonlyArray<string>): string {
		if (!path || path.length === 0) {
			return null;
		}
		let result = '';
		for (let index = 0; index < path.length; index += 1) {
			const segment = path[index];
			result += `${segment.length}:${segment}`;
			if (index < path.length - 1) {
				result += '|';
			}
		}
		return result;
	}

	private buildHid(moduleId: string, key: string): string {
		return `${moduleId}::${key}`;
	}
}

export function isHandlerFunction(candidate: unknown): candidate is HandlerFn {
	return typeof candidate === 'function'
		&& Object.prototype.hasOwnProperty.call(candidate, '__hid')
		&& Object.prototype.hasOwnProperty.call(candidate, '__hmod');
}
