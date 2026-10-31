import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { LuaWrittenExpression } from '../../../../toolchain/ts/lua/semantic/written_sources';
import { appendAffine2, relativeAffine2 } from '../../../common/affine2';
import { appendAffine3, relativeAffine3 } from '../../../common/affine3';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { TextBuffer } from '../../../editor/text/text_buffer';
import { createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import type { LuaSourceReader } from '../../../language/lua/source_reader';
import type { SceneSourceAffine, SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry, SceneSourceObject } from './model';
import { createSceneNameEdit, createScenePlacementEdits, finishSceneSpatialEdits } from './spatial_edits';
import { readSceneSourceAffine } from './authored_affine';
import type { ScenePrefabSources } from './prefab_sources';

type PrefabSpatial = { readonly family: '2d' | '3d'; readonly authority: 'affine' | 'root_origin'; readonly local: SceneSourceAffine | undefined };
type SpatialInput = { readonly file: FileSemanticData; readonly table: LuaTableConstructorExpression;
	readonly local: LuaWrittenExpression | null | undefined; readonly localSupplied: boolean };
export type SceneSpatialParents = ReadonlyMap<SceneSourceObject, SceneSourceObject | undefined>;
export type SceneSpatialTopology = { readonly parents: SceneSpatialParents; readonly capabilities: ReadonlyMap<SceneSourceObject, PrefabSpatial | false | undefined> };
/** Authored source occurrences and derived poses, shared by viewport rendering and manipulation.
 * An unavailable world pose is not an identity transform or invented geometry. */
export type SceneSpatialReadModel = {
	readonly entries: readonly SceneSourceObject[];
	readonly constructionOrder: readonly SceneSourceObject[];
	readonly parents: SceneSpatialParents;
	readonly worlds: ReadonlyMap<SceneSourceObject, Readonly<SceneSourceAffine> | undefined>;
};
type SceneSpatialGraph = SceneSpatialTopology & {
	readonly entries: readonly SceneSourceObject[];
	readonly constructionOrder: SceneSourceObject[];
	readonly ids: ReadonlyMap<SceneSourceObject, string | undefined>;
	readonly byId: ReadonlyMap<string, SceneSourceObject | undefined>;
	readonly inputs: ReadonlyMap<SceneSourceObject, SpatialInput | undefined>;
	readonly parentIds: ReadonlyMap<SceneSourceObject, string | undefined>;
	readonly references: ReadonlyMap<string, readonly SceneSourceObject[]>;
	readonly children: ReadonlyMap<SceneSourceObject, readonly SceneSourceObject[]>;
	readonly relationshipsComplete: boolean;
	readonly locals: Map<SceneSourceObject, SceneSourceAffine | undefined>;
	readonly worlds: Map<SceneSourceObject, SceneSourceAffine | undefined>;
	worldsProjected: boolean;
	readonly previous: ReadonlyMap<SceneSourceEntry, SceneSourceEntry>;
	readonly next: ReadonlyMap<SceneSourceEntry, SceneSourceEntry>;
};
export type SceneReparentMode = 'keep_world' | 'keep_local';
export type SceneReparentChoice = {
	readonly parent: SceneSourceObject | undefined;
	readonly label: string;
	readonly description: string;
	readonly local: Readonly<SceneSourceAffine> | undefined;
};
export type SceneRenamePlan = { readonly initialName: string; readonly occupied: ReadonlySet<string>; readonly references: readonly SceneSourceObject[] };
const NO_REPARENT_CHOICES: readonly SceneReparentChoice[] = [];
const NO_SCENE_REFERENCES: readonly SceneSourceObject[] = [];

/** Immutable-snapshot source graph and operation admission, not a guest World.
 * Each Scene and selected operation is projected once; steady command queries
 * consume retained facts and edit bundles. Concrete source occurrences own IDs. */
export class SceneSpatialProjection {
	private readonly reader: LuaSourceReader;
	private readonly graphs = new WeakMap<SceneSourceDefinition, SceneSpatialGraph>();
	private readonly removals = new WeakMap<SceneSourceObject, readonly EditorTextEdit[] | undefined>();
	private readonly subtrees = new WeakMap<SceneSourceObject, readonly EditorTextEdit[] | undefined>();
	private readonly reparentings = new WeakMap<SceneSourceObject, Map<SceneReparentMode, readonly SceneReparentChoice[]>>();
	private readonly renames = new WeakMap<SceneSourceObject, SceneRenamePlan | undefined>();
	private prefabs: Map<string, PrefabSpatial | false | undefined> | undefined;
	public constructor(private readonly previousTopologies: WeakMap<SceneSourceDefinition, SceneSpatialTopology>,
		private readonly prefabSources: ScenePrefabSources) { this.reader = prefabSources.reader; }

	public getSpatialParents(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneSpatialParents { return this.graph(document, scene).parents; }
	/** Materialize the complete authored scene once; steady readers borrow the existing graph and pose cache. */
	public readScene(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneSpatialReadModel {
		const graph = this.graph(document, scene);
		if (!graph.worldsProjected) {
			this.projectConstructionOrder(graph);
			for (const entry of graph.entries) this.worldAffine(graph, entry);
			graph.worldsProjected = true;
		}
		return graph;
	}
	public sibling(document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject, direction: -1 | 1): SceneSourceEntry | undefined {
		const graph = this.graph(document, scene);
		return (direction < 0 ? graph.previous : graph.next).get(member);
	}

	public memberRemovalEdits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): readonly EditorTextEdit[] | undefined {
		if (!this.removals.has(member)) {
			const graph = this.graph(document, scene), id = graph.ids.get(member);
			let edits: EditorTextEdit[] | undefined;
			if (graph.relationshipsComplete && (id !== undefined || [...graph.parentIds.values()].every(parent => parent === undefined))) {
				const chunk = document.analysis.chunk;
				edits = createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, member.field);
				const children = id === undefined ? undefined : graph.references.get(id);
				if (children !== undefined) for (const child of children) {
					const world = this.worldAffine(graph, child);
					if (world === undefined) { edits = undefined; break; }
					edits.push(...createScenePlacementEdits(buffer, document, child, undefined, world,
						this.localAffine(graph, child), graph.inputs.get(child)!.localSupplied));
				}
			}
			this.removals.set(member, edits === undefined ? undefined : finishSceneSpatialEdits(edits));
		}
		return this.removals.get(member);
	}

	public subtreeRemovalEdits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): readonly EditorTextEdit[] | undefined {
		if (!this.subtrees.has(member)) {
			const graph = this.graph(document, scene);
			let edits: EditorTextEdit[] | undefined;
			if (graph.relationshipsComplete && graph.parents.has(member)) {
				const selected: SceneSourceObject[] = [member];
				for (let index = 0; index < selected.length; index++) {
					const current = selected[index], id = graph.ids.get(current);
					const incoming = id === undefined ? undefined : graph.references.get(id);
					if (incoming !== undefined && (graph.byId.get(id!) !== current
						|| incoming.some(child => !graph.parents.has(child) || graph.parents.get(child) !== current))) { selected.length = 0; break; }
					const descendants = graph.children.get(current);
					if (descendants !== undefined) for (const child of descendants) selected.push(child);
				}
				if (selected.length > 0) {
					edits = [];
					const chunk = document.analysis.chunk;
					for (const entry of selected) edits.push(...createLuaTableFieldRemovalEdits(buffer, chunk.locations, chunk.tokens, entry.field));
				}
			}
			this.subtrees.set(member, edits === undefined ? undefined : finishSceneSpatialEdits(edits));
		}
		return this.subtrees.get(member);
	}

	public reparentChoices(document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject, mode: SceneReparentMode): readonly SceneReparentChoice[] {
		let modes = this.reparentings.get(member);
		if (modes === undefined) { modes = new Map(); this.reparentings.set(member, modes); }
		if (modes.has(mode)) return modes.get(mode)!;
		const graph = this.graph(document, scene), capability = graph.capabilities.get(member), id = graph.ids.get(member);
		const choices: SceneReparentChoice[] = [];
		if (graph.relationshipsComplete && capability && id !== undefined && graph.byId.get(id) === member) {
			const descendants = new Set<SceneSourceObject>([member]), pending: SceneSourceObject[] = [member];
			for (let index = 0; index < pending.length; index++) {
				const children = graph.children.get(pending[index]);
				if (children !== undefined) for (const child of children) { descendants.add(child); pending.push(child); }
			}
			const world = mode === 'keep_world' ? this.worldAffine(graph, member) : undefined;
			if (mode === 'keep_local' || world !== undefined) {
				for (const parent of [undefined, ...graph.entries]) {
					if (graph.parents.has(member) && graph.parents.get(member) === parent) continue;
					let parentId: string | undefined;
					if (parent !== undefined) {
						const parentCapability = graph.capabilities.get(parent);
						parentId = graph.ids.get(parent);
						if (capability.authority === 'root_origin' || !parentCapability || parentCapability.family !== capability.family
							|| parentId === undefined || graph.byId.get(parentId) !== parent || !graph.parents.has(parent) || descendants.has(parent)) continue;
					}
					let local = world === undefined ? undefined : { ...world };
					if (mode === 'keep_world' && parent !== undefined) {
						const parentWorld = this.worldAffine(graph, parent);
						if (local?.family === '2d' && parentWorld?.family === '2d') { if (!relativeAffine2(local, local, parentWorld)) continue; }
						else if (local?.family === '3d' && parentWorld?.family === '3d') { if (!relativeAffine3(local, local, parentWorld)) continue; }
						else continue;
					}
					choices.push({ parent, label: parent === undefined ? 'Scene Root' : parentId!,
						description: parent === undefined ? 'No parent' : '', local });
				}
			}
		}
		const admitted = choices.length === 0 ? NO_REPARENT_CHOICES : choices;
		modes.set(mode, admitted); return admitted;
	}

	/** Only the accepted picker choice produces source bytes. */
	public reparentEdits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject,
		choice: SceneReparentChoice): readonly EditorTextEdit[] {
		const graph = this.graph(document, scene), parentId = choice.parent === undefined ? undefined : graph.ids.get(choice.parent)!;
		return finishSceneSpatialEdits(createScenePlacementEdits(buffer, document, member, parentId, choice.local,
			this.localAffine(graph, member), graph.inputs.get(member)?.localSupplied === true));
	}

	public renamePlan(document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject): SceneRenamePlan | undefined {
		if (!this.renames.has(member)) {
			const graph = this.graph(document, scene), name = graph.ids.get(member);
			let plan: SceneRenamePlan | undefined;
			if (graph.relationshipsComplete && name !== undefined && graph.entries.every(entry => graph.ids.get(entry) !== undefined)) {
				const references = graph.references.get(name) ?? NO_SCENE_REFERENCES;
				if (references.length === 0 || graph.byId.get(name) === member) {
					const occupied = new Set<string>(); for (const entry of graph.entries) if (entry !== member) occupied.add(graph.ids.get(entry)!);
					plan = { initialName: name, occupied, references };
				}
			}
			this.renames.set(member, plan);
		}
		return this.renames.get(member);
	}

	public renameEdits(buffer: TextBuffer, document: SceneSourceDocument, scene: SceneSourceDefinition, member: SceneSourceObject, plan: SceneRenamePlan, name: string): readonly EditorTextEdit[] {
		if (name === plan.initialName) return [];
		const graph = this.graph(document, scene), edits = [createSceneNameEdit(buffer, document, member.memberId, name)];
		for (const child of plan.references) {
			const spatial = child.spatial!, table = spatial.field.value;
			if (table.kind === LuaSyntaxKind.TableConstructorExpression) {
				for (const field of table.fields) if (staticLuaTableFieldName(field) === 'parent_id'
					&& this.reader.stringValue(document.analysis, field.value) === plan.initialName)
					edits.push(createSceneNameEdit(buffer, document, field.value, name));
			} else edits.push(...createScenePlacementEdits(buffer, document, child, name, undefined, undefined, graph.inputs.get(child)!.localSupplied));
		}
		return finishSceneSpatialEdits(edits);
	}

	private graph(document: SceneSourceDocument, scene: SceneSourceDefinition): SceneSpatialGraph {
		const cached = this.graphs.get(scene); if (cached !== undefined) return cached;
		const file = document.analysis, reader = this.reader, entries: SceneSourceObject[] = [];
		const ids = new Map<SceneSourceObject, string | undefined>(), byId = new Map<string, SceneSourceObject | undefined>();
		const inputs = new Map<SceneSourceObject, SpatialInput | undefined>(), parentIds = new Map<SceneSourceObject, string | undefined>();
		const capabilities = new Map<SceneSourceObject, PrefabSpatial | false | undefined>();
		if (this.prefabs === undefined) this.prefabs = this.readPrefabs();
		for (const entry of scene.objects) {
			if (entry.kind !== 'object') continue;
			entries.push(entry);
			const identity = reader.member(file, entry.field.value, 'member_id');
			const id = identity === undefined ? undefined : reader.stringValue(identity.file, identity.expression); ids.set(entry, id);
			if (id !== undefined) byId.set(id, byId.has(id) ? undefined : entry);
			const definition = reader.member(file, entry.field.value, 'definition_id');
			const definitionId = definition === undefined ? undefined : reader.stringValue(definition.file, definition.expression);
			capabilities.set(entry, definitionId === undefined ? undefined : this.prefabs.get(definitionId));
			const spatial = reader.memberState(file, entry.field.value, 'spatial');
			if (spatial === null || spatial?.expression.kind === LuaSyntaxKind.NilLiteralExpression) { inputs.set(entry, undefined); parentIds.set(entry, undefined); continue; }
			if (spatial?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) continue;
			const local = reader.memberState(spatial.file, spatial.expression, 'local_transform');
			inputs.set(entry, { file: spatial.file, table: spatial.expression,
				local, localSupplied: local !== null && local?.expression.kind !== LuaSyntaxKind.NilLiteralExpression });
			const parent = reader.memberState(spatial.file, spatial.expression, 'parent_id');
			if (parent === null || parent?.expression.kind === LuaSyntaxKind.NilLiteralExpression) parentIds.set(entry, undefined);
			else if (parent !== undefined) { const name = reader.stringValue(parent.file, parent.expression); if (name !== undefined) parentIds.set(entry, name); }
		}
		const candidateParents = new Map<SceneSourceObject, SceneSourceObject | undefined>();
		const references = new Map<string, SceneSourceObject[]>();
		for (const [entry, parentId] of parentIds) {
			if (parentId === undefined) { candidateParents.set(entry, undefined); continue; }
			let referenced = references.get(parentId); if (referenced === undefined) { referenced = []; references.set(parentId, referenced); } referenced.push(entry);
			const parent = byId.get(parentId); if (parent === undefined) continue;
			const capability = capabilities.get(entry), parentCapability = capabilities.get(parent);
			if (parentCapability === false || capability === false || capability && capability.authority === 'root_origin'
				|| capability && parentCapability && capability.family !== parentCapability.family) continue;
			candidateParents.set(entry, parent);
		}
		let parents = new Map<SceneSourceObject, SceneSourceObject | undefined>();
		const invalid = new Set<SceneSourceObject>();
		for (const entry of entries) {
			if (parents.has(entry) || invalid.has(entry)) continue;
			const path: SceneSourceObject[] = [], visiting = new Set<SceneSourceObject>();
			let current: SceneSourceObject | undefined = entry;
			while (current !== undefined && !parents.has(current) && !invalid.has(current) && !visiting.has(current) && candidateParents.has(current)) {
				path.push(current); visiting.add(current); current = candidateParents.get(current);
			}
			const valid = current === undefined || parents.has(current);
			for (const node of path) { if (valid) parents.set(node, candidateParents.get(node)); else invalid.add(node); }
		}
		const previousTopology = this.previousTopologies.get(scene);
		if (previousTopology !== undefined && previousTopology.parents.size === parents.size && previousTopology.capabilities.size === capabilities.size
			&& entries.every(entry => previousTopology.parents.has(entry) === parents.has(entry) && previousTopology.parents.get(entry) === parents.get(entry)
				&& sameCapability(previousTopology.capabilities.get(entry), capabilities.get(entry)))) parents = previousTopology.parents as typeof parents;
		this.previousTopologies.set(scene, { parents, capabilities });
		const children = new Map<SceneSourceObject, SceneSourceObject[]>();
		for (const [child, parent] of parents) if (parent !== undefined) {
			let list = children.get(parent); if (list === undefined) { list = []; children.set(parent, list); } list.push(child);
		}
		const previous = new Map<SceneSourceEntry, SceneSourceEntry>(), next = new Map<SceneSourceEntry, SceneSourceEntry>();
		const last = new Map<SceneSourceObject | undefined, SceneSourceEntry>();
		for (const entry of scene.objects) {
			if (entry.kind !== 'object' || !parents.has(entry)) { last.clear(); continue; }
			const parent = parents.get(entry), sibling = last.get(parent);
			if (sibling !== undefined) { previous.set(entry, sibling); next.set(sibling, entry); } last.set(parent, entry);
		}
		const constructionOrder: SceneSourceObject[] = [];
		const graph = { entries, constructionOrder, ids, byId, inputs, parentIds, references, children, capabilities, parents, previous, next,
			relationshipsComplete: scene.resolution === 'complete' && parentIds.size === entries.length,
			locals: new Map<SceneSourceObject, SceneSourceAffine | undefined>(), worlds: new Map<SceneSourceObject, SceneSourceAffine | undefined>(), worldsProjected: false };
		this.graphs.set(scene, graph); return graph;
	}

	private projectConstructionOrder(graph: SceneSpatialGraph): void {
		// Match ScenePlan's smallest-ready authored ordering using the admitted
		// parent/child index, not a separately constructed scene tree.
		const { entries, parents, children, constructionOrder } = graph;
		const ready: number[] = [], indices = new Map<SceneSourceObject, number>();
		for (let index = 0; index < entries.length; index++) {
			const entry = entries[index]; indices.set(entry, index);
			if (parents.has(entry) && parents.get(entry) === undefined) ready.push(index);
		}
		while (ready.length > 0) {
			const index = ready[0], last = ready.pop()!;
			if (ready.length > 0) {
				let position = 0, child = 1;
				while (child < ready.length) {
					if (child + 1 < ready.length && ready[child + 1] < ready[child]) child++;
					if (last < ready[child]) break;
					ready[position] = ready[child]; position = child; child = position * 2 + 1;
				}
				ready[position] = last;
			}
			const entry = entries[index]; constructionOrder.push(entry);
			const descendants = children.get(entry);
			if (descendants !== undefined) for (const descendant of descendants) {
				const index = indices.get(descendant)!;
				let position = ready.length; ready.push(index);
				while (position > 0) {
					const parent = (position - 1) >>> 1;
					if (ready[parent] < index) break;
					ready[position] = ready[parent]; position = parent;
				}
				ready[position] = index;
			}
		}
	}

	private worldAffine(graph: SceneSpatialGraph, member: SceneSourceObject): SceneSourceAffine | undefined {
		if (!graph.parents.has(member)) return undefined;
		if (graph.worlds.has(member)) return graph.worlds.get(member);
		const chain: SceneSourceObject[] = [];
		let current: SceneSourceObject | undefined = member, valid = true;
		while (current !== undefined && !graph.worlds.has(current)) {
			chain.push(current);
			current = graph.parents.get(current);
		}
		let parent = current === undefined ? undefined : graph.worlds.get(current);
		if (current !== undefined && parent === undefined) valid = false;
		for (let index = chain.length - 1; index >= 0; index--) {
			const node = chain[index], local = this.localAffine(graph, node);
			if (!valid || local === undefined) { valid = false; graph.worlds.set(node, undefined); continue; }
			if (parent === undefined) parent = { ...local };
			else if (parent.family === '2d' && local.family === '2d') { parent = { ...parent }; appendAffine2(parent, local.xx, local.xy, local.yx, local.yy, local.ox, local.oy); }
			else if (parent.family === '3d' && local.family === '3d') { parent = { ...parent }; appendAffine3(parent, local); }
			else { valid = false; graph.worlds.set(node, undefined); continue; }
			graph.worlds.set(node, parent);
		}
		return graph.worlds.get(member);
	}

	private localAffine(graph: SceneSpatialGraph, member: SceneSourceObject): SceneSourceAffine | undefined {
		if (!graph.locals.has(member)) {
			const input = graph.inputs.get(member);
			const capability = graph.capabilities.get(member);
			let local: SceneSourceAffine | undefined;
			if (input?.localSupplied) local = input.local === undefined ? undefined : readSceneSourceAffine(this.reader, input.local!.file, input.local!.expression);
			else if (graph.inputs.has(member)) local = capability ? capability.local : undefined;
			graph.locals.set(member, local);
		}
		return graph.locals.get(member);
	}

	private readPrefabs(): Map<string, PrefabSpatial | false | undefined> {
		const prefabs = new Map<string, PrefabSpatial | false | undefined>(), reader = this.reader;
		for (const [id, definition] of this.prefabSources.all) {
			if (definition === undefined) { prefabs.set(id, undefined); continue; }
			const spatial = reader.memberState(definition.file, definition.expression, 'spatial');
			if (spatial === null || spatial?.expression.kind === LuaSyntaxKind.NilLiteralExpression) { prefabs.set(id, false); continue; }
			if (spatial?.expression.kind !== LuaSyntaxKind.TableConstructorExpression) { prefabs.set(id, undefined); continue; }
			const familySource = reader.member(spatial.file, spatial.expression, 'family'), authoritySource = reader.member(spatial.file, spatial.expression, 'authority');
			const family = familySource === undefined ? undefined : reader.stringValue(familySource.file, familySource.expression);
			const authority = authoritySource === undefined ? undefined : reader.stringValue(authoritySource.file, authoritySource.expression);
			if ((family !== '2d' && family !== '3d') || (authority !== 'affine' && authority !== 'root_origin')) { prefabs.set(id, undefined); continue; }
			const transform = reader.memberState(spatial.file, spatial.expression, 'local_transform');
			const local = transform === null || transform?.expression.kind === LuaSyntaxKind.NilLiteralExpression
				? family === '2d' ? { family: '2d' as const, xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }
					: { family: '3d' as const, xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 0, oy: 0, oz: 0 }
				: transform === undefined ? undefined : readSceneSourceAffine(reader, transform.file, transform.expression);
			prefabs.set(id, { family, authority, local: local?.family === family ? local : undefined });
		}
		return prefabs;
	}
}

function sameCapability(left: PrefabSpatial | false | undefined, right: PrefabSpatial | false | undefined): boolean {
	return left === right || !!left && !!right && left.family === right.family && left.authority === right.authority;
}
