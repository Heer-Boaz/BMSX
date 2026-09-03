import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
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
import { collectBehaviorRegistrationSources } from './recognizer';

const EMPTY_REGISTRATION_SOURCES: readonly BehaviorRegistrationSource[] = [];

type BehaviorRegistrationGeneration = {
	readonly snapshot: LuaSemanticWorkspaceSnapshot;
	readonly sourcesByKind: ReadonlyMap<
		BehaviorKind,
		ReadonlyMap<string, readonly BehaviorRegistrationSource[]>
	>;
};

/** Workspace-generation index for source-owned behavior registrations. */
export class BehaviorRegistrationIndex {
	private readonly generations: [
		BehaviorRegistrationGeneration | null,
		BehaviorRegistrationGeneration | null,
	] = [null, null];
	private readonly documentVersions = new WeakMap<EditorTextModel, number>();

	public constructor(private readonly sources: RuntimeSourceState) {}

	public resolve(
		executionDomain: 0 | 1,
		behaviorKind: BehaviorKind,
		semanticId: string,
	): readonly BehaviorRegistrationSource[] {
		const project = getOrCreateSemanticProject(executionDomain);
		project.synchronizeRuntimeSources(this.sources);
		this.synchronizeOpenDocuments(executionDomain, project);
		const snapshot = project.getSnapshot();
		let generation = this.generations[executionDomain];
		if (generation === null || generation.snapshot !== snapshot) {
			generation = this.buildGeneration(executionDomain, snapshot);
			this.generations[executionDomain] = generation;
		}
		return generation.sourcesByKind.get(behaviorKind)?.get(semanticId)
			|| EMPTY_REGISTRATION_SOURCES;
	}

	private synchronizeOpenDocuments(
		executionDomain: 0 | 1,
		project: EditorLuaSemanticProject,
	): void {
		let changedDocuments: SemanticDocumentInput[] | null = null;
		for (const model of editorTextModelService.models) {
			if (model.mode !== 'lua' || model.resource.domain !== executionDomain) {
				continue;
			}
			const version = model.version;
			if (this.documentVersions.get(model) === version) {
				continue;
			}
			this.documentVersions.set(model, version);
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
		executionDomain: 0 | 1,
		snapshot: LuaSemanticWorkspaceSnapshot,
	): BehaviorRegistrationGeneration {
		const sourcesByKind = new Map<
			BehaviorKind,
			Map<string, BehaviorRegistrationSource[]>
		>();
		const records = this.sources.cartridgeSlots[executionDomain]!.luaSources.records;
		for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
			const record = records[recordIndex];
			if (!record.program_module || record.generated) {
				continue;
			}
			const resource = {
				domain: executionDomain,
				path: record.source_path,
			} as const;
			const registrations = collectBehaviorRegistrationSources(
				resource,
				snapshot.getFileData(record.source_path)!,
			);
			for (let registrationIndex = 0;
				registrationIndex < registrations.length;
				registrationIndex += 1) {
				const registration = registrations[registrationIndex];
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
		return { snapshot, sourcesByKind };
	}
}
