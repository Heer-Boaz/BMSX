import type { ParsedLuaChunk } from '../../../../../../toolchain/ts/lua/analysis/parse';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type FileSemanticData,
	type LuaSemanticWorkspaceSnapshot,
} from '../../../../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceRegistry } from '../../../../../runtime/source_registry';
import {
	runtimeLuaSourceRegistry,
	type RuntimeSourceState,
} from '../../../../../runtime/sources';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type ResourceDomain,
} from '../../../../../common/resource';
import { readWorkspaceLuaSourceText } from '../../../../../workspace/files';

export type SemanticDocumentInput = {
	path: string;
	source: string;
	parsed?: ParsedLuaChunk;
};

// The editor project is the single mutable owner above immutable semantic
// workspace snapshots. Runtime registries provide the project base while open
// editor documents retain their newer source until the editor session releases
// the entire project.
export class EditorLuaSemanticProject {
	private readonly workspace = new LuaSemanticWorkspace();
	private readonly documentPaths = new Set<string>();
	private basePaths: ReadonlySet<string> = new Set();
	private primaryRegistry: LuaSourceRegistry | null = null;
	private primaryRevision = -1;
	private systemRegistry: LuaSourceRegistry | null = null;
	private systemRevision = -1;

	public constructor(private readonly domain: ResourceDomain) {}

	public synchronizeRuntimeSources(sources: RuntimeSourceState): void {
		const primaryRegistry = runtimeLuaSourceRegistry(sources, this.domain);
		const systemRegistry = sources.systemLuaSources;
		if (this.primaryRegistry === primaryRegistry
			&& (primaryRegistry === null || this.primaryRevision === primaryRegistry.revision)
			&& this.systemRegistry === systemRegistry
			&& this.systemRevision === systemRegistry.revision) {
			return;
		}

		const registries: LuaSourceRegistry[] = [];
		if (this.domain !== SYSTEM_RESOURCE_DOMAIN && primaryRegistry !== null) {
			registries.push(primaryRegistry);
		}
		registries.push(systemRegistry);
		const nextBasePaths = new Set<string>();
		const changedAnalyses: FileSemanticData[] = [];
		for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
			const registry = registries[registryIndex];
			for (let recordIndex = 0; recordIndex < registry.records.length; recordIndex += 1) {
				const record = registry.records[recordIndex];
				const path = record.source_path;
				if (nextBasePaths.has(path)) {
					continue;
				}
				nextBasePaths.add(path);
				if (this.documentPaths.has(path)) {
					continue;
				}
				const source = readWorkspaceLuaSourceText(registry, record);
				const existing = this.workspace.getFileData(path);
				if (!existing || existing.source !== source) {
					changedAnalyses.push(buildLuaFileSemanticData(source, path));
				}
			}
		}

		const removedPaths: string[] = [];
		for (const path of this.basePaths) {
			if (!nextBasePaths.has(path) && !this.documentPaths.has(path)) {
				removedPaths.push(path);
			}
		}
		this.workspace.updateFiles(changedAnalyses, removedPaths);
		this.basePaths = nextBasePaths;
		this.primaryRegistry = primaryRegistry;
		this.primaryRevision = primaryRegistry === null ? -1 : primaryRegistry.revision;
		this.systemRegistry = systemRegistry;
		this.systemRevision = systemRegistry.revision;
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

	// disable-next-line single_line_method_pattern -- The project exposes retained analysis without leaking its mutable workspace owner.
	public getFileData(path: string): FileSemanticData | undefined {
		return this.workspace.getFileData(path);
	}

	// disable-next-line single_line_method_pattern -- Providers consume immutable generations while the mutable workspace remains project-owned.
	public getSnapshot(): LuaSemanticWorkspaceSnapshot {
		return this.workspace.getSnapshot();
	}
}
