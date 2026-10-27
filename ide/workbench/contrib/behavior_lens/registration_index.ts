import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type {
	BehaviorKind,
	BehaviorRegistrationSource,
} from './model';
import { LuaSourceReader } from '../../../language/lua/source_reader';
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
	private readonly generations = new Map<string, BehaviorRegistrationGeneration>();

	public constructor(private readonly models: EditorTextModelService, private readonly catalog: WorkspaceSourceCatalog) {}

	public resolve(
		contextId: string,
		behaviorKind: BehaviorKind,
		semanticId: string,
	): readonly BehaviorRegistrationSource[] {
		return this.getGeneration(contextId).sourcesByKind.get(behaviorKind)?.get(semanticId)
			|| EMPTY_REGISTRATION_SOURCES;
	}

	public getRegistrations(contextId: string): readonly BehaviorRegistrationSource[] {
		return this.getGeneration(contextId).registrations;
	}

	private getGeneration(contextId: string): BehaviorRegistrationGeneration {
		const project = getOrCreateSemanticProject(this.models, contextId);
		project.synchronizeSources(this.catalog);
		const snapshot = project.getSnapshot();
		let generation = this.generations.get(contextId);
		if (generation === undefined || generation.snapshot !== snapshot) {
			generation = this.buildGeneration(contextId, snapshot);
			this.generations.set(contextId, generation);
		}
		return generation;
	}

	private buildGeneration(
		contextId: string,
		snapshot: LuaSemanticWorkspaceSnapshot,
	): BehaviorRegistrationGeneration {
		const reader = new LuaSourceReader(snapshot);
		const allRegistrations: BehaviorRegistrationSource[] = [];
		const sourcesByKind = new Map<
			BehaviorKind,
			Map<string, BehaviorRegistrationSource[]>
		>();
		for (const resource of this.catalog.luaResources) {
			if (resource.contextId !== contextId) continue;
			const { registrations } = collectBehaviorRegistrations(resource, reader);
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
