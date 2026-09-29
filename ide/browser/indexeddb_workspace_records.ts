import type { WorkspaceDirectoryEntry, WorkspaceRecord, WorkspaceRecordProvider } from '../workspace/record_provider';

const DATABASE = 'bmsx-studio-workspace';
const RECORDS = 'records';
const ENTRIES = 'entries';

type Entry = { path: string; name: string; parent?: string; type: 'file' | 'directory' };

/** Chromium can report quota denial with an empty message; the native error code carries the cause. */
function workspaceStorageError(cause: DOMException): Error {
	return new Error(cause.name === 'QuotaExceededError'
		? 'Browser storage quota exceeded.'
		: `Browser storage failed (${cause.name}): ${cause.message}`, { cause });
}

/** File admission and its parent directories share the content write's transaction. */
function admitFile(entries: IDBObjectStore, path: string, overwrite: boolean, admitted: () => void, abort: (error: Error) => void): void {
	const destination = entries.get(path);
	destination.onsuccess = () => {
		const existing: Entry | undefined = destination.result;
		if (existing !== undefined) {
			if (existing.type === 'directory') { abort(new Error(`Is a directory: ${path}`)); return; }
			if (!overwrite) { abort(new Error(`File already exists: ${path}`)); return; }
			// Existing files already own their namespace: ordinary Save does not re-walk the parents.
			admitted();
			return;
		}
		let offset = 0;
		const next = () => {
			const slash = path.indexOf('/', offset);
			const parent = offset === 0 ? '' : path.slice(0, offset - 1);
			if (slash === -1) {
				entries.add({ path, name: path.slice(offset), parent, type: 'file' } satisfies Entry);
				admitted();
				return;
			}
			const key = path.slice(0, slash), request = entries.get(key);
			request.onsuccess = () => {
				const entry: Entry | undefined = request.result;
				if (entry === undefined) {
					entries.add({ path: key, name: path.slice(offset, slash), parent, type: 'directory' } satisfies Entry);
				} else if (entry.type !== 'directory') {
					abort(new Error(`Not a directory: ${key}`));
					return;
				}
				offset = slash + 1;
				next();
			};
		};
		next();
	};
}

/** Browser-owned canonical source, with a transactionally indexed filesystem namespace. */
export class IndexedDbWorkspaceRecordProvider implements WorkspaceRecordProvider {
	public readonly persistence = 'browser';
	private constructor(private readonly database: IDBDatabase) {
		database.onversionchange = () => database.close();
	}

	public static open(): Promise<IndexedDbWorkspaceRecordProvider> {
		return new Promise((resolve, reject) => {
			let failure: Error | undefined;
			const request = indexedDB.open(DATABASE, 2);
			request.onupgradeneeded = event => {
				const database = request.result, transaction = request.transaction!;
				if (event.oldVersion === 0) database.createObjectStore(RECORDS);
				const entries = database.createObjectStore(ENTRIES, { keyPath: 'path' });
				entries.createIndex('parent', 'parent');
				entries.add({ path: '', name: '', type: 'directory' } satisfies Entry);
				// Version 1 stored only contents. Index those files without rewriting or dropping them.
				const scan = transaction.objectStore(RECORDS).openKeyCursor();
				scan.onsuccess = () => {
					const cursor = scan.result;
					if (cursor === null) return;
					admitFile(entries, cursor.key as string, false, () => cursor.continue(), error => {
						failure = error; transaction.abort();
					});
				};
			};
			request.onerror = () => reject(failure === undefined ? workspaceStorageError(request.error!) : failure);
			request.onsuccess = () => resolve(new IndexedDbWorkspaceRecordProvider(request.result));
		});
	}

	public close(): void { this.database.close(); }

	/** Only transaction completion acknowledges writes; namespace and contents commit together. */
	private transaction<T>(mode: IDBTransactionMode, operation: (
		records: IDBObjectStore, entries: IDBObjectStore, abort: (error: Error) => void,
	) => () => T): Promise<T> {
		return new Promise((resolve, reject) => {
			let failure: Error | undefined;
			const transaction = this.database.transaction([RECORDS, ENTRIES], mode);
			transaction.onabort = () => reject(failure === undefined ? workspaceStorageError(transaction.error!) : failure);
			const result = operation(transaction.objectStore(RECORDS), transaction.objectStore(ENTRIES), error => {
				failure = error; transaction.abort();
			});
			transaction.oncomplete = () => resolve(result());
		});
	}

	public read(path: string): Promise<WorkspaceRecord | null> {
		return this.transaction('readonly', (records, entries, abort) => {
			let record: IDBRequest<WorkspaceRecord> | undefined;
			const request = entries.get(path);
			request.onsuccess = () => {
				const entry: Entry | undefined = request.result;
				if (entry === undefined) return;
				if (entry.type === 'directory') { abort(new Error(`Is a directory: ${path}`)); return; }
				record = records.get(path);
			};
			return () => record === undefined ? null : record.result;
		});
	}

	public async write(path: string, record: WorkspaceRecord, overwrite: boolean): Promise<void> {
		await this.transaction('readwrite', (records, entries, abort) => {
			admitFile(entries, path, overwrite, () => records.put(record, path), abort);
			return () => undefined;
		});
	}

	public async delete(path: string): Promise<void> {
		await this.transaction('readwrite', (records, entries, abort) => {
			const request = entries.get(path);
			request.onsuccess = () => {
				const entry: Entry | undefined = request.result;
				if (entry === undefined) return;
				if (entry.type === 'directory') { abort(new Error(`Is a directory: ${path}`)); return; }
				entries.delete(path); records.delete(path);
			};
			return () => undefined;
		});
	}

	public readDirectory(path: string): Promise<WorkspaceDirectoryEntry[] | null> {
		return this.transaction('readonly', (_records, entries, abort) => {
			let children: IDBRequest<Entry[]> | undefined;
			const request = entries.get(path);
			request.onsuccess = () => {
				const entry: Entry | undefined = request.result;
				if (entry === undefined) return;
				if (entry.type !== 'directory') { abort(new Error(`Not a directory: ${path}`)); return; }
				children = entries.index('parent').getAll(path);
			};
			return () => children === undefined ? null : children.result.map(({ name, type }) => ({ name, type }));
		});
	}
}
