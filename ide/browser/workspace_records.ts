import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';

export class HttpWorkspaceRecordProvider implements WorkspaceRecordProvider {
	private session: Promise<string> | undefined;

	/** Coalesce local session admission. Never persist or put a capability in a URL. */
	private connect(): Promise<string> {
		if (this.session === undefined) {
			const pending = fetch('/__bmsx__/session', { headers: { 'X-BMSX-Client': 'studio' }, cache: 'no-store' })
				.then(async response => {
					if (!response.ok) throw new Error(`[WorkspaceStorage] Session unavailable: ${await response.text()}`);
					return (await response.json()).workspaceToken as string;
				}).catch(error => {
					if (this.session === pending) this.session = undefined;
					throw error;
				});
			this.session = pending;
		}
		return this.session;
	}

	/** Only a rejected capability permits replay: the server has performed no file operation. */
	private async request(url: string, init: RequestInit): Promise<Response> {
		const session = this.connect();
		const headers = new Headers(init.headers);
		headers.set('Authorization', `Bearer ${await session}`);
		const response = await fetch(url, { ...init, headers });
		if (response.status !== 401) return response;
		await response.body?.cancel();
		if (this.session === session) this.session = undefined;
		headers.set('Authorization', `Bearer ${await this.connect()}`);
		return fetch(url, { ...init, headers });
	}

	public async readDirectory(relativePath: string): Promise<WorkspaceDirectoryEntry[] | null> {
		const response = await this.request(`${WORKSPACE_FILE_ENDPOINT}?directory=${encodeURIComponent(relativePath)}`, {
			method: 'GET', cache: 'no-store',
		});
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`[WorkspaceStorage] Failed to read directory '${relativePath}': ${await response.text()}`);
		return response.json();
	}

	public async read(relativePath: string): Promise<WorkspaceRecord | null> {
		const response = await this.request(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'GET', cache: 'no-store',
		});
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`[WorkspaceStorage] Failed to read '${relativePath}': ${await response.text()}`);
		return response.json();
	}

	public async write(relativePath: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		const response = await this.request(WORKSPACE_FILE_ENDPOINT, {
			method: 'PUT',
			headers: overwrite ? { 'Content-Type': 'application/json' }
				: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
			body: JSON.stringify({ path: relativePath, ...record }),
		});
		if (response.status === 412) throw new Error(`File already exists: ${relativePath}`);
		if (!response.ok) throw new Error(`[WorkspaceStorage] Failed to write '${relativePath}': ${await response.text()}`);
	}

	public async delete(relativePath: string): Promise<void> {
		const response = await this.request(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'DELETE',
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(`[WorkspaceStorage] Failed to delete '${relativePath}': ${await response.text()}`);
		}
	}
}
