import type { KeyValueStorage } from '../workspace/key_value_storage';

export class MemoryStorage implements KeyValueStorage {
	private readonly store = new Map<string, string>();

	public getItem(key: string): string | null {
		return this.store.has(key) ? this.store.get(key)! : null;
	}

	public setItem(key: string, value: string): void {
		this.store.set(key, value);
	}

	public removeItem(key: string): void {
		this.store.delete(key);
	}
}
