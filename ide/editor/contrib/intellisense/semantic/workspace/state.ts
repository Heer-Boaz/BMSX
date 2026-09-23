import type { ResourceDomain } from '../../../../../common/resource';
import type { EditorTextModelService } from '../../../../model/model_service';
import { EditorLuaSemanticProject } from './project';

const projectsByModels = new WeakMap<EditorTextModelService, Map<ResourceDomain, EditorLuaSemanticProject>>();

/** Semantic projects share the exact working-copy owner, not merely matching paths/domains. */
export function getOrCreateSemanticProject(models: EditorTextModelService, domain: ResourceDomain): EditorLuaSemanticProject {
	let projects = projectsByModels.get(models);
	if (projects === undefined) {
		projects = new Map();
		projectsByModels.set(models, projects);
		models.onWillClear(() => resetSemanticProjects(models));
	}
	const project = projects.get(domain);
	if (project) {
		return project;
	}
	const created = new EditorLuaSemanticProject(domain, models);
	projects.set(domain, created);
	return created;
}

export function resetSemanticProject(models: EditorTextModelService, domain: ResourceDomain): EditorLuaSemanticProject {
	const projects = projectsByModels.get(models);
	projects?.get(domain)?.dispose();
	projects?.delete(domain);
	return getOrCreateSemanticProject(models, domain);
}

export function resetSemanticProjects(models: EditorTextModelService): void {
	const projects = projectsByModels.get(models);
	if (projects === undefined) return;
	for (const project of projects.values()) project.dispose();
	projects.clear();
}
