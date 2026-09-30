import type { StudioCartridgeProject } from '../../hosts/common/studio_projects';
import type { WorkspaceProjects } from '../workbench/services/projects';
import type { StudioHttpSession } from './http_session';

export class HttpWorkspaceProjects implements WorkspaceProjects {
	public constructor(private readonly session: StudioHttpSession) {}
	public async createCartridge(target: string): Promise<StudioCartridgeProject> {
		const response = await this.session.request(`/__bmsx__/projects/${encodeURIComponent(target)}`, { method: 'PUT' });
		if (!response.ok) throw new Error(`Cannot create cartridge (${response.status}): ${await response.text()}`);
		return response.json();
	}
}
