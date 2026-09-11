import type { ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshot,
} from '../../../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../../../../runtime/source_registry';
import {
	runtimeLuaSourceRegistry,
	type RuntimeSourceState,
} from '../../../../../runtime/sources';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../../../../common/resource';
import { readWorkspaceLuaSourceText } from '../../../../../workspace/files';
import type { EditorTextModelService } from '../../../../model/model_service';
import type { EditorTextModel } from '../../../../model/text_model';
import { getTextSnapshot } from '../../../../text/source_text';

export type SemanticDocumentInput = {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
};

type ProjectBaseSource = {
	readonly domain: ResourceDomain;
	readonly registry: LuaSourceRegistry;
	readonly record: LuaSourceRecord;
};

// The editor project is the single mutable owner above immutable semantic
// workspace snapshots. Model events queue source changes, not analysis work.
// Runtime registries provide the base; retained models and explicit document
// inputs own the newer source regardless of which view happens to be active.
export class EditorLuaSemanticProject {
	private readonly workspace = new LuaSemanticWorkspace();
	private readonly documentPaths = new Set<string>();
	private readonly pendingPaths = new Set<string>();
	private baseSources: ReadonlyMap<string, ProjectBaseSource> = new Map();
	private readonly modelSubscriptions: readonly (() => void)[];
	private primaryRegistry: LuaSourceRegistry | undefined;
	private primaryRevision = -1;
	private systemRegistry: LuaSourceRegistry | null = null;
	private systemRevision = -1;

	public constructor(
		private readonly domain: ResourceDomain,
		private readonly models: EditorTextModelService,
	) {
		const queueModel = (model: EditorTextModel): void => {
			if (model.mode === 'lua'
				&& (model.resource.domain === domain || model.resource.domain === SYSTEM_RESOURCE_DOMAIN)) {
				this.pendingPaths.add(model.resource.path);
			}
		};
		this.modelSubscriptions = [
			models.onDidAddModel(queueModel),
			models.onDidChangeContent(queueModel),
			models.onDidRemoveModel(model => {
				if (model.mode === 'lua' && model.resource.domain === domain) this.documentPaths.delete(model.resource.path);
				queueModel(model);
			}),
		];
		for (const model of models.models) queueModel(model);
	}

	public dispose(): void {
		for (const unsubscribe of this.modelSubscriptions) unsubscribe();
		this.pendingPaths.clear();
	}

	public synchronizeRuntimeSources(sources: RuntimeSourceState): void {
		const primaryRegistry = runtimeLuaSourceRegistry(sources, this.domain);
		const systemRegistry = sources.systemLuaSources;
		if (this.primaryRegistry === primaryRegistry
			&& (primaryRegistry === undefined || this.primaryRevision === primaryRegistry.revision)
			&& this.systemRegistry === systemRegistry
			&& this.systemRevision === systemRegistry.revision) {
			return;
		}

		const registries: { domain: ResourceDomain; registry: LuaSourceRegistry }[] = [];
		if (this.domain !== SYSTEM_RESOURCE_DOMAIN && primaryRegistry !== undefined) {
			registries.push({ domain: this.domain, registry: primaryRegistry });
		}
		registries.push({ domain: SYSTEM_RESOURCE_DOMAIN, registry: systemRegistry });
		const nextBaseSources = new Map<string, ProjectBaseSource>();
		for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
			const { domain, registry } = registries[registryIndex];
			for (let recordIndex = 0; recordIndex < registry.records.length; recordIndex += 1) {
				const record = registry.records[recordIndex];
				const path = record.source_path;
				if (nextBaseSources.has(path)) {
					continue;
				}
				nextBaseSources.set(path, { domain, registry, record });
				this.pendingPaths.add(path);
			}
		}

		for (const path of this.baseSources.keys()) {
			if (!nextBaseSources.has(path)) this.pendingPaths.add(path);
		}
		this.baseSources = nextBaseSources;
		this.primaryRegistry = primaryRegistry;
		this.primaryRevision = primaryRegistry === undefined ? -1 : primaryRegistry.revision;
		this.systemRegistry = systemRegistry;
		this.systemRevision = systemRegistry.revision;
	}

	private synchronizeDocuments(): void {
		if (this.pendingPaths.size === 0) return;
		const changedAnalyses: FileSemanticData[] = [];
		const removedPaths: string[] = [];
		for (const path of this.pendingPaths) {
			const base = this.baseSources.get(path);
			let model = this.models.get({ domain: this.domain, path });
			if (model === undefined) {
				if (this.documentPaths.has(path)) continue;
				if (this.domain !== SYSTEM_RESOURCE_DOMAIN && base?.domain !== this.domain) {
					model = this.models.get({ domain: SYSTEM_RESOURCE_DOMAIN, path });
				}
			}
			if (model === undefined && base === undefined) {
				removedPaths.push(path);
				continue;
			}
			const source = model === undefined
				? readWorkspaceLuaSourceText(base!.registry, base!.record)
				: getTextSnapshot(model.buffer);
			const existing = this.workspace.getFileData(path);
			if (existing === undefined || existing.source !== source) {
				changedAnalyses.push(buildLuaFileSemanticData(source, path));
			}
		}
		this.pendingPaths.clear();
		this.workspace.updateFiles(changedAnalyses, removedPaths);
	}

	public updateDocument(path: string, source: string, parsed?: ParsedLuaChunk): FileSemanticData {
		this.documentPaths.add(path);
		return this.workspace.updateFile(path, source, parsed);
	}

	public updateDocuments(inputs: ReadonlyArray<SemanticDocumentInput>): void {
		const changedAnalyses: FileSemanticData[] = [];
		for (let index = 0; index < inputs.length; index += 1) {
			const input = inputs[index];
			this.documentPaths.add(input.path);
			const existing = this.workspace.getFileData(input.path);
			if (!existing || existing.source !== input.source) {
				changedAnalyses.push(buildLuaFileSemanticData(
					input.source,
					input.path,
					input.parsed,
				));
			}
		}
		this.workspace.updateFiles(changedAnalyses);
	}

	public getFileData(path: string): FileSemanticData | undefined {
		this.synchronizeDocuments();
		return this.workspace.getFileData(path);
	}

	public getSnapshot(): LuaSemanticWorkspaceSnapshot {
		this.synchronizeDocuments();
		return this.workspace.getSnapshot();
	}
}
