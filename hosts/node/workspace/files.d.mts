export const WORKSPACE_SAVE_DIRECTORY: string;
export function deleteWorkspaceRecord(destination: string): Promise<void>;
export function publishWorkspaceRecord(
	destination: string,
	stagingDirectory: string,
	record: { contents: string; updatedAt: number },
	overwrite: boolean,
	expectedSource?: string | null,
): Promise<void>;
