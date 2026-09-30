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

	/** Finite workspace operations may replay only a pre-operation admission rejection, never a transport failure. */
	public async request(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		for (let attempt = 0; ; attempt++) {
			const admission = this.connect();
			headers.set('Authorization', `Bearer ${await admission}`);
			try {
				const response = await fetch(this.baseUrl + path, { ...init, headers });
				if (response.status !== 401 || attempt !== 0) return response;
				await response.body?.cancel();
				this.expire(admission);
			} catch (error) {
				this.expire(admission);
				throw error;
			}
		}
	}

	/** A late rejection of an older admission must not clear a newer shared one. */
	public expire(admission: Promise<string>): void { if (this.pending === admission) this.pending = undefined; }
}
