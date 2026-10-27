import type { EditorTextModelService } from '../../../../model/model_service';
import { EditorLuaSemanticProject } from './project';

const projectsByModels = new WeakMap<EditorTextModelService, Map<string, EditorLuaSemanticProject>>();

/** Semantic projects share the exact working-copy owner, not merely matching paths/contexts. */
export function getOrCreateSemanticProject(models: EditorTextModelService, contextId: string): EditorLuaSemanticProject {
	let projects = projectsByModels.get(models);
	if (projects === undefined) {
		projects = new Map();
		projectsByModels.set(models, projects);
		models.onWillClear(() => resetSemanticProjects(models));
	}
	const project = projects.get(contextId);
	if (project) {
		return project;
	}
	const created = new EditorLuaSemanticProject(contextId, models);
	projects.set(contextId, created);
	return created;
}

export function resetSemanticProject(models: EditorTextModelService, contextId: string): EditorLuaSemanticProject {
	const projects = projectsByModels.get(models);
	projects?.get(contextId)?.dispose();
	projects?.delete(contextId);
	return getOrCreateSemanticProject(models, contextId);
}

export function resetSemanticProjects(models: EditorTextModelService): void {
	const projects = projectsByModels.get(models);
	if (projects === undefined) return;
	for (const project of projects.values()) project.dispose();
	projects.clear();
}
