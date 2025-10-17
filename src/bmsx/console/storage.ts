import type { StorageService } from '../platform/platform';

export class BmsxConsoleStorage {
	private readonly storage: StorageService;
	private namespace: string;

	constructor(storage: StorageService, defaultNamespace: string) {
		this.storage = storage;
		this.namespace = this.validateNamespace(defaultNamespace);
	}

	public setNamespace(nextNamespace: string): void {
		this.namespace = this.validateNamespace(nextNamespace);
	}

	public getNamespace(): string {
		return this.namespace;
	}

	public setValue(index: number, value: number): void {
		this.assertIndex(index);
		if (!Number.isFinite(value)) {
			throw new Error(`[BmsxConsoleStorage] Attempted to persist non-finite value '${value}' at index ${index}.`);
		}
		const key = this.keyFor(index);
		this.storage.setItem(key, value.toString(10));
	}

	public getValue(index: number): number {
		this.assertIndex(index);
		const key = this.keyFor(index);
		const raw = this.storage.getItem(key);
		if (raw === null) {
			return 0;
		}
		const parsed = Number(raw);
		if (!Number.isFinite(parsed)) {
			throw new Error(`[BmsxConsoleStorage] Stored value '${raw}' at index ${index} is not a finite number.`);
		}
		return parsed;
	}

	private keyFor(index: number): string {
		return `bmsx.console.${this.namespace}.${index}`;
	}

	private validateNamespace(ns: string): string {
		if (!ns || ns.trim().length === 0) {
			throw new Error('[BmsxConsoleStorage] Namespace must be a non-empty string.');
		}
		return ns.trim();
	}

	private assertIndex(index: number): void {
		if (!Number.isInteger(index) || index < 0) {
			throw new Error(`[BmsxConsoleStorage] Index '${index}' must be a non-negative integer.`);
		}
	}
}
