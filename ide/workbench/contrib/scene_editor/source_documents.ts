import type { ResourceIdentity } from '../../../common/resource';
import { resourceIdentityKey } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import type { EditorLuaSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/project';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { FileSemanticData, LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceObject } from './model';
import { buildSceneSourceDocument } from './source';
import { SceneMemberRemovalProjection } from './member_removal';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { luaSourceLocation } from '../../../language/lua/source_location';

/** Shared immutable source projections; selections and controls belong to their authored contexts. */
export class SceneSourceDocuments {
	private readonly generations = new WeakMap<LuaSemanticWorkspaceSnapshot, Map<string, SceneSourceDocument>>();
	private readonly previous = new WeakMap<EditorLuaSemanticProject, WeakMap<FileSemanticData, SceneSourceDocument>>();
	private readonly modelGenerations = new WeakMap<EditorTextModel, { readonly revision: symbol; readonly document: SceneSourceDocument }>();
	private readonly memberRemovals = new WeakMap<LuaSemanticWorkspaceSnapshot, SceneMemberRemovalProjection>();

	public constructor(private readonly models: EditorTextModelService, private readonly catalog: WorkspaceSourceCatalog) {}

	public get(model: EditorTextModel): SceneSourceDocument {
		const project = getOrCreateSemanticProject(this.models, model.resource.contextId);
		project.synchronizeSources(this.catalog);
		const snapshot = project.getSnapshot();
		let generation = this.modelGenerations.get(model);
		if (generation === undefined || generation.revision !== snapshot.revision) {
			generation = { revision: snapshot.revision, document: this.getForSnapshot(model.resource, snapshot) };
			this.modelGenerations.set(model, generation);
		}
		return generation.document;
	}

	public getSourceLocation(model: EditorTextModel, document: SceneSourceDocument, range?: LuaSourceRange): EditorSourceLocation | undefined {
		return luaSourceLocation(getOrCreateSemanticProject(this.models, model.resource.contextId), model, document.analysis, range);
	}

	/** Resolve destructive source edits against the current Scene and prefab generation. */
	public memberRemovalEdits(model: EditorTextModel, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): readonly EditorTextEdit[] | undefined {
		const project = getOrCreateSemanticProject(this.models, model.resource.contextId);
		project.synchronizeSources(this.catalog);
		const snapshot = project.getSnapshot();
		const generation = this.modelGenerations.get(model);
		if (generation?.revision !== snapshot.revision || generation.document !== document) return;
		let projection = this.memberRemovals.get(snapshot);
		if (projection === undefined) {
			projection = new SceneMemberRemovalProjection(snapshot);
			this.memberRemovals.set(snapshot, projection);
		}
		return projection.edits(model.buffer, document, scene, member);
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
