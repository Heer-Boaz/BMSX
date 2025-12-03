import type { LuaInterpreter } from '../lua/runtime';
import { createLuaNativeFunction, type LuaFunctionValue } from '../lua/value';
import type { LuaFunctionRedirectRecord } from './types';

export type LuaHandlerCategory = string;

export type LuaHandlerBindContext = {
	fn: LuaFunctionValue;
	interpreter: LuaInterpreter;
};

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
		const redirect = createLuaNativeFunction(`redirect:${path[path.length - 1] ?? 'fn'}`, (args) => {
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
