import type { MessagePort } from 'node:worker_threads';
import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../../../ide/workspace/record_provider';
import type { HeadlessStudioRequest, StudioWorkspaceOperation, StudioWorkspaceReply, StudioWorkspaceValue } from './headless_protocol';

/** Worker documents use the server's canonical filesystem owner, never a second writer realm. */
export class WorkerWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public readonly persistence = 'workspace';
	private serial = 0;
	private readonly pending = new Map<number, { resolve(value: StudioWorkspaceValue): void; reject(error: unknown): void }>();
	public constructor(private readonly port: MessagePort) {
		port.on('message', (message: HeadlessStudioRequest) => {
			if (message.type !== 'workspace-result') return;
			this.receive(message);
		});
		port.once('close', () => {
			const error = new Error('Studio workspace connection closed. An accepted write may have completed; do not replay it.');
			for (const pending of this.pending.values()) pending.reject(error);
			this.pending.clear();
		});
	}

	public read(path: string): Promise<WorkspaceRecord | null> { return this.request({ method: 'read', path }); }
	public readDirectory(path: string): Promise<WorkspaceDirectoryEntry[] | null> { return this.request({ method: 'readDirectory', path }); }
	public createDirectory(path: string): Promise<void> { return this.request({ method: 'createDirectory', path }); }
	public write(path: string, record: WorkspaceRecord, overwrite: boolean, expectedSource?: string | null): Promise<void> {
		return this.request({ method: 'write', path, record, overwrite, expectedSource });
	}
	public delete(path: string): Promise<void> { return this.request({ method: 'delete', path }); }

	private request<T>(operation: StudioWorkspaceOperation): Promise<T> {
		const request = ++this.serial, completion = Promise.withResolvers<StudioWorkspaceValue>();
		this.pending.set(request, completion);
		this.port.postMessage({ type: 'workspace-request', request, operation });
		return completion.promise as Promise<T>;
	}
	private receive(message: StudioWorkspaceReply): void {
		const pending = this.pending.get(message.request)!;
		this.pending.delete(message.request);
		if (message.success === true) pending.resolve(message.value);
		else pending.reject(message.error);
	}
}
