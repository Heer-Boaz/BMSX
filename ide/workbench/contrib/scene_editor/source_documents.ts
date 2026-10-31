import type { ResourceIdentity } from '../../../common/resource';
import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorLuaSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/project';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { SceneSourceDefinition, SceneSourceDocument } from './model';
import { buildSceneSourceDocument } from './source';
import { SceneSpatialProjection, type SceneSpatialTopology } from './spatial_projection';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { luaSourceLocation } from '../../../language/lua/source_location';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { ScenePrefabSources } from './prefab_sources';
import { SceneVisualProjection } from './visual_projection';

/** Shared immutable source projections; selections and controls belong to their authored contexts. */
export class SceneSourceDocuments {
	private readonly generations = new WeakMap<LuaSemanticWorkspaceSnapshot, Map<string, SceneSourceDocument>>();
	private readonly previous = new WeakMap<EditorLuaSemanticProject, WeakMap<FileSemanticData, SceneSourceDocument>>();
	private readonly modelGenerations = new WeakMap<EditorTextModel, { readonly snapshot: LuaSemanticWorkspaceSnapshot; readonly document: SceneSourceDocument }>();
	private readonly spatialProjections = new WeakMap<LuaSemanticWorkspaceSnapshot, SceneSpatialProjection>();
	private readonly previousSpatialTopologies = new WeakMap<SceneSourceDefinition, SceneSpatialTopology>();
	private readonly prefabSources = new WeakMap<LuaSemanticWorkspaceSnapshot, ScenePrefabSources>();
	private readonly visualProjections = new WeakMap<LuaSemanticWorkspaceSnapshot, SceneVisualProjection>();

	public constructor(private readonly models: EditorTextModelService, private readonly catalog: WorkspaceSourceCatalog) {}

	public get(model: EditorTextModel): SceneSourceDocument {
		const project = getOrCreateSemanticProject(this.models, model.resource.contextId);
		project.synchronizeSources(this.catalog);
		const snapshot = project.getSnapshot();
		let generation = this.modelGenerations.get(model);
		if (generation === undefined || generation.snapshot !== snapshot) {
			generation = { snapshot, document: this.getForSnapshot(model.resource, snapshot) };
			this.modelGenerations.set(model, generation);
		}
		return generation.document;
	}

	public getSourceLocation(model: EditorTextModel, document: SceneSourceDocument, range?: LuaSourceRange): EditorSourceLocation | undefined {
		return luaSourceLocation(getOrCreateSemanticProject(this.models, model.resource.contextId), model, document.analysis, range);
	}

	/** Consume the source/dependency generation already admitted by get(). */
	public getSpatialProjection(model: EditorTextModel, document: SceneSourceDocument): SceneSpatialProjection | undefined {
		const generation = this.modelGenerations.get(model);
		if (generation?.document !== document) return;
		const snapshot = generation.snapshot;
		let projection = this.spatialProjections.get(snapshot);
		if (projection === undefined) {
			projection = new SceneSpatialProjection(this.previousSpatialTopologies, this.getPrefabSources(snapshot));
			this.spatialProjections.set(snapshot, projection);
		}
		return projection;
	}

	public getVisualProjection(model: EditorTextModel, document: SceneSourceDocument): SceneVisualProjection | undefined {
		const generation = this.modelGenerations.get(model);
		if (generation?.document !== document) return;
		const snapshot = generation.snapshot;
		let projection = this.visualProjections.get(snapshot);
		if (projection === undefined) {
			projection = new SceneVisualProjection(this.getPrefabSources(snapshot), this.getSpatialProjection(model, document)!);
			this.visualProjections.set(snapshot, projection);
		}
		return projection;
	}

	private getPrefabSources(snapshot: LuaSemanticWorkspaceSnapshot): ScenePrefabSources {
		let sources = this.prefabSources.get(snapshot);
		if (sources === undefined) {
			sources = new ScenePrefabSources(new LuaSourceReader(snapshot));
			this.prefabSources.set(snapshot, sources);
		}
		return sources;
	}

	/** Discovery already owns this semantic proof; it neither opens models nor requests another snapshot. */
	public getForSnapshot(resource: ResourceIdentity, snapshot: LuaSemanticWorkspaceSnapshot): SceneSourceDocument {
		let generation = this.generations.get(snapshot);
		if (generation === undefined) {
			generation = new Map();
			this.generations.set(snapshot, generation);
		}
		const address = resourceIdentityKey(resource);
		let document = generation.get(address);
		if (document !== undefined) return document;
		const project = getOrCreateSemanticProject(this.models, resource.contextId);
		let previous = this.previous.get(project);
		if (previous === undefined) {
			previous = new WeakMap();
			this.previous.set(project, previous);
		}
		const analysis = snapshot.getFileData(address)!;
		document = buildSceneSourceDocument(resource, snapshot, previous.get(analysis));
		previous.set(analysis, document);
		generation.set(address, document);
		return document;
	}
}
