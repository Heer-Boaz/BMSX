import type { StudioCartridgeProject } from '../../../hosts/common/studio_projects';

export interface WorkspaceProjects {
	createCartridge(target: string): Promise<StudioCartridgeProject>;
}
