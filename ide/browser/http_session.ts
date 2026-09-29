import { STUDIO_CONNECT_MS } from '../../hosts/common/studio_tools';

export class StudioAdmissionError extends Error {
	public constructor(public readonly status: number, detail: string) { super(`Studio admission (${status}): ${detail}`); }
}

/** Per-client same-origin server admission. Capabilities stay in memory, never URLs or persisted state. */
export class StudioHttpSession {
	private pending: Promise<string> | undefined;
	public constructor(public readonly baseUrl = '') {}

	public connect(): Promise<string> {
		if (this.pending === undefined) {
			const pending = fetch(`${this.baseUrl}/__bmsx__/session`, { headers: { 'X-BMSX-Client': 'studio' }, cache: 'no-store', signal: AbortSignal.timeout(STUDIO_CONNECT_MS) })
				.then(async response => {
					if (!response.ok) throw new StudioAdmissionError(response.status, await response.text());
					return (await response.json()).workspaceToken as string;
				}).catch(error => { this.expire(pending); throw error; });
			this.pending = pending;
		}
		return this.pending;
	}

	/** A late rejection of an older admission must not clear a newer shared one. */
	public expire(admission: Promise<string>): void { if (this.pending === admission) this.pending = undefined; }
}
