import type { LuaHandlerFn } from '../../lua/handler_cache';
import { LuaNativeFunction } from '../../lua/runtime';
import { type LuaFunctionValue } from '../../lua/value';
import type { LuaFunctionRedirectRecord } from '../runtime/contracts';

export class LuaFunctionRedirectCache {
	private readonly byKey = new Map<string, LuaFunctionRedirectRecord>();
	private readonly byModule = new Map<string, Set<string>>();

	public getOrCreate(moduleId: string, path: ReadonlyArray<string>, fn: LuaFunctionValue): LuaFunctionValue {
		const key = this.buildKey(moduleId, path);
		let record = this.byKey.get(key);
		if (!record) {
			record = this.createRecord(moduleId, key, path, fn);
			this.byKey.set(key, record);
			this.index(moduleId, key);
			return record.redirect;
		}
		if (fn === record.redirect) {
			return record.redirect;
		}
		record.current = fn;
		return record.redirect;
	}

	public clear(): void {
		this.byKey.clear();
		this.byModule.clear();
	}

	private createRecord(moduleId: string, key: string, path: ReadonlyArray<string>, fn: LuaFunctionValue): LuaFunctionRedirectRecord {
		const record: LuaFunctionRedirectRecord = {
			key,
			moduleId,
			path: path.slice(),
			current: fn,
			redirect: null,
		};
		const redirect = new LuaNativeFunction(`redirect:${path[path.length - 1] ?? 'fn'}`, (args) => {
			return record.current.call(args);
		});
		record.redirect = redirect;
		return record;
	}

	private index(moduleId: string, key: string): void {
		let bucket = this.byModule.get(moduleId);
		if (!bucket) {
			bucket = new Set<string>();
			this.byModule.set(moduleId, bucket);
		}
		bucket.add(key);
	}

	private buildKey(moduleId: string, path: ReadonlyArray<string>): string {
		return `${moduleId}::${path.join('.')}`;
	}
}

export type LuaScriptHandler<TArgs extends unknown[] = unknown[], TResult = unknown> =
	((...args: TArgs) => TResult) | LuaHandlerFn;
