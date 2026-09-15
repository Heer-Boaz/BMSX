/** Filesystem transport. Ordering, recovery records and timestamps belong to records.ts. */
export interface WorkspaceRecordProvider {
	read(relativePath: string): Promise<WorkspaceRecord | null>;
	readDirectory(relativePath: string): Promise<WorkspaceDirectoryEntry[] | null>;
	/** overwrite=false is an exclusive filesystem create, not a read-before-write check. */
	write(relativePath: string, record: WorkspaceRecord, overwrite: boolean): Promise<void>;
	delete(relativePath: string): Promise<void>;
}

export type WorkspaceDirectoryEntry = {
	name: string;
	type: 'file' | 'directory' | 'symbolic-link' | 'other';
};

export type WorkspaceRecord = {
	contents: string;
	updatedAt: number;
};
