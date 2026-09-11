import type { ResourceDomain } from '../../../../../common/resource';
import { editorTextModelService } from '../../../../model/model_service';
import { EditorLuaSemanticProject } from './project';

const semanticProjects = new Map<ResourceDomain, EditorLuaSemanticProject>();

export function getOrCreateSemanticProject(domain: ResourceDomain): EditorLuaSemanticProject {
	const project = semanticProjects.get(domain);
	if (project) {
		return project;
	}
	const created = new EditorLuaSemanticProject(domain, editorTextModelService);
	semanticProjects.set(domain, created);
	return created;
}

export function resetSemanticProject(domain: ResourceDomain): EditorLuaSemanticProject {
	semanticProjects.get(domain)?.dispose();
	const project = new EditorLuaSemanticProject(domain, editorTextModelService);
	semanticProjects.set(domain, project);
	return project;
}

export function resetSemanticProjects(): void {
	for (const project of semanticProjects.values()) project.dispose();
	semanticProjects.clear();
}
