import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { ResourceDomain } from '../../../common/resource';
import type {
	EditorLuaSemanticProject,
	SemanticDocumentInput,
} from '../../../editor/contrib/intellisense/semantic/workspace/project';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type {
	BehaviorKind,
	BehaviorRegistrationSource,
} from './model';
import { collectBehaviorRegistrations } from './registrations';

const EMPTY_REGISTRATION_SOURCES: readonly BehaviorRegistrationSource[] = [];

type BehaviorRegistrationGeneration = {
	readonly snapshot: LuaSemanticWorkspaceSnapshot;
	readonly registrations: readonly BehaviorRegistrationSource[];
	readonly sourcesByKind: ReadonlyMap<
		BehaviorKind,
		ReadonlyMap<string, readonly BehaviorRegistrationSource[]>
	>;
};

/** Workspace-generation index for source-owned behavior registrations. */
export class BehaviorRegistrationIndex {
	private readonly generations = new Map<ResourceDomain, BehaviorRegistrationGeneration>();
	private readonly files = new Map<ResourceDomain, WeakMap<FileSemanticData, readonly BehaviorRegistrationSource[]>>();
	private readonly documentVersions = new WeakMap<EditorLuaSemanticProject, WeakMap<EditorTextModel, number>>();

	public constructor(private readonly sources: RuntimeSourceState) {}

	public resolve(
		executionDomain: 0 | 1,
		behaviorKind: BehaviorKind,
		semanticId: string,
	): readonly BehaviorRegistrationSource[] {
		return this.getGeneration(executionDomain).sourcesByKind.get(behaviorKind)?.get(semanticId)
			|| EMPTY_REGISTRATION_SOURCES;
	}

	public getRegistrations(domain: ResourceDomain): readonly BehaviorRegistrationSource[] {
		return this.getGeneration(domain).registrations;
	}

	private getGeneration(executionDomain: ResourceDomain): BehaviorRegistrationGeneration {
		const project = getOrCreateSemanticProject(executionDomain);
		project.synchronizeRuntimeSources(this.sources);
		this.synchronizeOpenDocuments(executionDomain, project);
		const snapshot = project.getSnapshot();
		let generation = this.generations.get(executionDomain);
		if (generation === undefined || generation.snapshot !== snapshot) {
			generation = this.buildGeneration(executionDomain, snapshot);
			this.generations.set(executionDomain, generation);
		}
		return generation;
	}

	private synchronizeOpenDocuments(
		executionDomain: ResourceDomain,
		project: EditorLuaSemanticProject,
	): void {
		let documentVersions = this.documentVersions.get(project);
		if (documentVersions === undefined) {
			documentVersions = new WeakMap();
			this.documentVersions.set(project, documentVersions);
		}
		let changedDocuments: SemanticDocumentInput[] | null = null;
		for (const model of editorTextModelService.models) {
			if (model.mode !== 'lua' || model.resource.domain !== executionDomain) {
				continue;
			}
			const version = model.version;
			if (documentVersions.get(model) === version) {
				continue;
			}
			documentVersions.set(model, version);
			if (changedDocuments === null) {
				changedDocuments = [];
			}
			changedDocuments.push({
				path: model.resource.path,
				source: getTextSnapshot(model.buffer),
			});
		}
		if (changedDocuments !== null) {
			project.updateDocuments(changedDocuments);
		}
	}

	private buildGeneration(
		executionDomain: ResourceDomain,
		snapshot: LuaSemanticWorkspaceSnapshot,
	): BehaviorRegistrationGeneration {
		let files = this.files.get(executionDomain);
		if (files === undefined) {
			files = new WeakMap();
			this.files.set(executionDomain, files);
		}
		const allRegistrations: BehaviorRegistrationSource[] = [];
		const sourcesByKind = new Map<
			BehaviorKind,
			Map<string, BehaviorRegistrationSource[]>
		>();
		for (const resource of this.sources.luaResources) {
			if (resource.domain !== executionDomain) continue;
			const analysis = snapshot.getFileData(resource.path)!;
			let registrations = files.get(analysis);
			if (registrations === undefined) {
				registrations = collectBehaviorRegistrations(resource, analysis).registrations;
				files.set(analysis, registrations);
			}
			for (let registrationIndex = 0;
				registrationIndex < registrations.length;
				registrationIndex += 1) {
				const registration = registrations[registrationIndex];
				allRegistrations.push(registration);
				if (registration.semanticId === null) continue;
				let sourcesById = sourcesByKind.get(registration.behaviorKind);
				if (sourcesById === undefined) {
					sourcesById = new Map();
					sourcesByKind.set(registration.behaviorKind, sourcesById);
				}
				let matchingSources = sourcesById.get(registration.semanticId);
				if (matchingSources === undefined) {
					matchingSources = [];
					sourcesById.set(registration.semanticId, matchingSources);
				}
				matchingSources.push(registration);
			}
		}
		return { snapshot, registrations: allRegistrations, sourcesByKind };
	}
}
