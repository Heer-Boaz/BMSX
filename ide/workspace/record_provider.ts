/** Filesystem transport. Ordering, recovery records and timestamps belong to records.ts. */
export interface WorkspaceRecordProvider {
	read(relativePath: string): Promise<WorkspaceRecord | null>;
	write(relativePath: string, record: WorkspaceRecord): Promise<void>;
	delete(relativePath: string): Promise<void>;
}

export type WorkspaceRecord = {
	contents: string;
	updatedAt: number;
};
