import type { WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

const WORKSPACE_FILE_ENDPOINT = '/__bmsx__/lua';

export class HttpWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public async read(relativePath: string): Promise<WorkspaceRecord | null> {
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'GET', cache: 'no-store',
		});
		if (response.status === 404) return null;
		if (!response.ok) throw new Error(`[WorkspaceStorage] Failed to read '${relativePath}': ${await response.text()}`);
		return response.json();
	}

	public async write(relativePath: string, record: WorkspaceRecord): Promise<void> {
		const response = await fetch(WORKSPACE_FILE_ENDPOINT, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: relativePath, ...record }),
		});
		if (!response.ok) throw new Error(`[WorkspaceStorage] Failed to write '${relativePath}': ${await response.text()}`);
	}

	public async delete(relativePath: string): Promise<void> {
		const response = await fetch(`${WORKSPACE_FILE_ENDPOINT}?path=${encodeURIComponent(relativePath)}`, {
			method: 'DELETE',
		});
		if (!response.ok && response.status !== 404) {
			throw new Error(`[WorkspaceStorage] Failed to delete '${relativePath}': ${await response.text()}`);
		}
	}
}
