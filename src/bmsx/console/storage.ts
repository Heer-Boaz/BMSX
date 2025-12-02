import type { StorageService } from '../platform/platform';

export class BmsxConsoleStorage {
	private readonly storage: StorageService;
	private namespace: string;
	private readonly touchedIndices: Set<number> = new Set();

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
		this.touchedIndices.add(index);
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
		this.touchedIndices.add(index);
		return parsed;
	}

	public dump(): { namespace: string; entries: Array<{ index: number; value: number }> } {
		const entries: Array<{ index: number; value: number }> = [];
		for (const index of this.touchedIndices) {
			const raw = this.storage.getItem(this.keyFor(index));
			if (raw === null) continue;
			const value = Number(raw);
			if (!Number.isFinite(value)) continue;
			entries.push({ index, value });
		}
		return { namespace: this.namespace, entries };
	}

	public restore(state: { namespace: string; entries: Array<{ index: number; value: number }> }): void {
		const previousIndices = Array.from(this.touchedIndices);
		for (const index of previousIndices) {
			this.storage.removeItem(this.keyFor(index));
		}
		this.touchedIndices.clear();
		if (!state) return;
		this.namespace = this.validateNamespace(state.namespace);
		for (const entry of state.entries) {
			this.assertIndex(entry.index);
			if (!Number.isFinite(entry.value)) {
				throw new Error(`[BmsxConsoleStorage] Restored value '${entry.value}' at index ${entry.index} is not finite.`);
			}
			this.storage.setItem(this.keyFor(entry.index), entry.value.toString(10));
			this.touchedIndices.add(entry.index);
		}
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
