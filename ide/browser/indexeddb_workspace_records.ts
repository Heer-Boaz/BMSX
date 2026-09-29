import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

const DATABASE = 'bmsx-studio-workspace';
const RECORDS = 'records';

/** Browser-owned canonical source, not a cache or a failed HTTP workspace. */
export class IndexedDbWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public readonly persistence = 'browser';
	private constructor(private readonly database: IDBDatabase) {
		database.onversionchange = () => database.close();
	}

	public static open(): Promise<IndexedDbWorkspaceRecordProvider> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(new IndexedDbWorkspaceRecordProvider(request.result));
		});
	}

	public close(): void { this.database.close(); }

	/** A request succeeding is not a committed write. Only transaction completion acknowledges it. */
	private transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			const transaction = this.database.transaction(RECORDS, mode);
			transaction.onabort = () => reject(transaction.error);
			const request = operation(transaction.objectStore(RECORDS));
			transaction.oncomplete = () => resolve(request.result);
		});
	}

	public async read(path: string): Promise<WorkspaceRecord | null> {
		const record = await this.transaction<WorkspaceRecord | undefined>('readonly', store => store.get(path));
		return record === undefined ? null : record;
	}

	public async write(path: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		try {
			await this.transaction('readwrite', store => overwrite ? store.put(record, path) : store.add(record, path));
		} catch (error) {
			if (error instanceof DOMException && error.name === 'ConstraintError') throw new Error(`File already exists: ${path}`);
			throw error;
		}
	}

	public async delete(path: string): Promise<void> {
		await this.transaction('readwrite', store => store.delete(path));
	}

	public async readDirectory(path: string): Promise<WorkspaceDirectoryEntry[] | null> {
		const prefix = path.length === 0 ? '' : `${path}/`;
		// '0' immediately follows '/' in IndexedDB's string-key ordering.
		const range = path.length === 0 ? undefined : IDBKeyRange.bound(prefix, `${path}0`, false, true);
		const entries: WorkspaceDirectoryEntry[] = [];
		await this.transaction('readonly', store => {
			const request = store.openKeyCursor(range);
			request.onsuccess = () => {
				const cursor = request.result;
				if (cursor === null) return;
				const relative = (cursor.key as string).slice(prefix.length);
				const separator = relative.indexOf('/');
				if (separator === -1) {
					entries.push({ name: relative, type: 'file' });
					cursor.continue();
				} else {
					const name = relative.slice(0, separator);
					entries.push({ name, type: 'directory' });
					// Skip descendants without reading their contents or repeating directory entries.
					cursor.continue(`${prefix}${name}0`);
				}
			};
			return request;
		});
		return entries.length === 0 && path.length !== 0 ? null : entries;
	}
}
