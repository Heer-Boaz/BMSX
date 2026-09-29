export interface KeyValueStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** Separate workspace authorities must never replay each other's recovery records. */
export class ScopedKeyValueStorage implements KeyValueStorage {
	public constructor(private readonly storage: KeyValueStorage, private readonly prefix: string) {}
	public getItem(key: string): string | null { return this.storage.getItem(this.prefix + key); }
	public setItem(key: string, value: string): void { this.storage.setItem(this.prefix + key, value); }
	public removeItem(key: string): void { this.storage.removeItem(this.prefix + key); }
}
