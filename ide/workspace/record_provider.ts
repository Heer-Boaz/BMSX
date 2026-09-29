/** Canonical filesystem I/O. Admission belongs to the transport; recovery belongs to the workbench. */
export interface WorkspaceRecordProvider {
	readonly persistence: 'workspace' | 'browser';
	read(relativePath: string): Promise<WorkspaceRecord | null>;
	readDirectory(relativePath: string): Promise<WorkspaceDirectoryEntry[] | null>;
	/** overwrite=false is an exclusive create in the owning store, not a read-before-write check. */
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
