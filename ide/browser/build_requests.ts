import type { StudioBuildRequest } from '../../hosts/common/studio_builds';

/** Unacknowledged requests, keyed independently so another window cannot replace the collection. */
export class StoredBuildRequests {
	private readonly requests = new Map<string, StudioBuildRequest>();
	private readonly prefix: string;
	public constructor(baseUrl: string) {
		const oldKey = `bmsx-build-requests:${baseUrl}`;
		this.prefix = `${oldKey}:`;
		// Preserve recovery identities written by the previous collection format.
		const saved = localStorage.getItem(oldKey);
		if (saved !== null) {
			for (const request of JSON.parse(saved) as StudioBuildRequest[]) this.add(request);
			localStorage.removeItem(oldKey);
		}
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(this.prefix)) this.read(key);
		}
		window.addEventListener('storage', this.changed);
	}

	public get pending(): readonly StudioBuildRequest[] { return [...this.requests.values()]; }
	public add(request: StudioBuildRequest): void {
		localStorage.setItem(`${this.prefix}${request.requestId}`, JSON.stringify(request));
		this.requests.set(request.requestId, request);
	}
	public delete(id: string): void {
		localStorage.removeItem(`${this.prefix}${id}`);
		this.requests.delete(id);
	}
	public dispose(): void { window.removeEventListener('storage', this.changed); }

	private readonly changed = (event: StorageEvent): void => {
		if (event.storageArea !== localStorage) return;
		if (event.key === null) { this.requests.clear(); return; }
		if (event.key.startsWith(this.prefix)) this.read(event.key);
	};
	private read(key: string): void {
		// Events can queue behind our own acknowledgement. Read the committed key,
		// not an older event.newValue that could resurrect an already removed receipt.
		const value = localStorage.getItem(key), id = key.slice(this.prefix.length);
		if (value === null) this.requests.delete(id);
		else this.requests.set(id, JSON.parse(value));
	}
}
