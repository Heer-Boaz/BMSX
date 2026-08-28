import type { ResourceDomain } from '../../../../../common/resource';
import { EditorLuaSemanticProject } from './project';

const semanticProjects = new Map<ResourceDomain, EditorLuaSemanticProject>();

export function getOrCreateSemanticProject(domain: ResourceDomain): EditorLuaSemanticProject {
	const project = semanticProjects.get(domain);
	if (project) {
		return project;
	}
	const created = new EditorLuaSemanticProject(domain);
	semanticProjects.set(domain, created);
	return created;
}

export function resetSemanticProject(domain: ResourceDomain): EditorLuaSemanticProject {
	const project = new EditorLuaSemanticProject(domain);
	semanticProjects.set(domain, project);
	return project;
}

export function resetSemanticProjects(): void {
	semanticProjects.clear();
}
