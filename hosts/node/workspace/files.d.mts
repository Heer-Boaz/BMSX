export const WORKSPACE_SAVE_DIRECTORY: string;
export function publishWorkspaceRecord(
	destination: string,
	stagingDirectory: string,
	record: { contents: string; updatedAt: number },
	overwrite: boolean,
): Promise<void>;
