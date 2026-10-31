import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import { stringLiteralValue } from '../../../../toolchain/ts/lua/syntax/literals';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeToTextRange, readLuaExpressionPreview, readLuaSourceRange } from '../../../language/lua/source_edits';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { SceneSourceDefinition, SceneSourceEntry } from './model';
import type { SceneHierarchyViewState } from './hierarchy_view';

type SceneOutlineSource = {
	readonly scene: SceneSourceDefinition;
	readonly source: LuaSourceRange;
	readonly span: TrackedTextRange;
	readonly label: string;
	readonly preserveLabelCase: boolean;
	readonly detail: string;
	readonly preserveDetailCase: boolean;
	readonly identity: string;
	displayLabel: string;
	labelClipped: boolean;
};
export type SceneMemberElement = SceneOutlineSource & {
	readonly kind: 'member'; readonly entry: SceneSourceEntry; readonly index: number;
	readonly unresolvedParent: boolean;
};
export type SceneOutlineElement = SceneOutlineSource & { readonly kind: 'scene' } | SceneMemberElement;

/** Source correspondence belongs to this outline, not to labels or the generic tree. */
export function installSceneOutline(input: SceneHierarchyViewState): void {
	input.authoring.refresh();
	const document = input.authoring.document!;
	input.outlineDocument = document;
	input.outlineSourceVersion = input.authoring.workingCopy.version;
	const { outline } = input;
	const { buffer } = input.authoring.workingCopy;
	const previous = new Map<number, WorkbenchTreeNode<SceneOutlineElement>>();
	const previousNodes = [...outline.roots];
	while (previousNodes.length > 0) {
		const node = previousNodes.pop()!;
		if (node.element.span.start !== node.element.span.end) previous.set(node.element.span.start, node);
		for (const child of node.children) previousNodes.push(child);
	}
	outline.roots.length = 0;
	input.outlineRanges.clear();
	input.outlineParents.clear();
	for (const scene of input.authoring.scenes) {
		const span = luaSourceRangeToTextRange(buffer, scene.range);
		const prior = previous.get(span.start);
		const locations = document.analysis.chunk.locations;
		const sceneId = stringLiteralValue(scene.id);
		const sceneIdentity = sceneId === undefined ? readLuaSourceRange(buffer, locations.range(scene.id.span)) : sceneId;
		const detail = `${scene.objects.length} MEMBERS${scene.resolution === 'partial' ? ' (PARTIAL)' : ''}`;
		const root = appendWorkbenchTreeNode(outline, null, {
			kind: 'scene', scene, source: scene.range, span,
			label: sceneId === undefined ? readLuaExpressionPreview(buffer, locations, scene.id) : sceneId,
			preserveLabelCase: sceneId !== undefined, detail, preserveDetailCase: false,
			identity: `${sourceTabDescription(input.authoring.workingCopy.resource)}:${scene.range.start.line}:${scene.range.start.column}\nScene ${sceneIdentity}\n${detail}`,
			displayLabel: '', labelClipped: false,
		}, prior !== undefined && prior.element.span.end === span.end && prior.collapsed);
		input.outlineRanges.set(root.element, root.element.span);
		const parents = input.authoring.getSpatialParents(scene);
		input.outlineParents.set(scene, parents);
		const children = new Map<SceneSourceEntry, number[]>(), roots: number[] = [];
		for (let index = 0; index < scene.objects.length; index += 1) {
			const entry = scene.objects[index];
			const parent = entry.kind === 'object' ? parents.get(entry) : undefined;
			if (parent === undefined) roots.push(index);
			else {
				let entries = children.get(parent);
				if (entries === undefined) { entries = []; children.set(parent, entries); }
				entries.push(index);
			}
		}
		const nodes = new Map<SceneSourceEntry, WorkbenchTreeNode<SceneOutlineElement>>();
		const pending = roots.reverse();
		while (pending.length > 0) {
			const index = pending.pop()!, entry = scene.objects[index];
			const range = locations.range(entry.field.span);
			const expression = entry.kind === 'object' ? entry.memberId : entry.field.value;
			const memberId = entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined;
			const definitionId = entry.kind === 'object' ? stringLiteralValue(entry.definitionId) : undefined;
			const identity = memberId === undefined ? readLuaSourceRange(buffer, locations.range(expression.span)) : memberId;
			const definition = entry.kind === 'object'
				? definitionId === undefined ? readLuaSourceRange(buffer, locations.range(entry.definitionId.span)) : definitionId : '';
			const parent = entry.kind === 'object' ? parents.get(entry) : undefined;
			const memberSpan = luaSourceRangeToTextRange(buffer, range), previousMember = previous.get(memberSpan.start);
			const unresolvedParent = entry.kind === 'object' && entry.spatial !== null && !parents.has(entry);
			const member = appendWorkbenchTreeNode(outline, parent === undefined ? root : nodes.get(parent)!, {
				kind: 'member', scene, entry, index, source: range, unresolvedParent,
				span: memberSpan,
				label: memberId === undefined ? readLuaExpressionPreview(buffer, locations, expression) : memberId,
				preserveLabelCase: memberId !== undefined,
				detail: entry.kind === 'object'
					? definitionId === undefined ? readLuaExpressionPreview(buffer, locations, entry.definitionId) : definitionId : 'Dynamic Lua composition',
				preserveDetailCase: definitionId !== undefined,
				identity: `${sourceTabDescription(input.authoring.workingCopy.resource)}:${range.start.line}:${range.start.column}\nScene ${sceneIdentity}\n${entry.kind === 'object' ? `Member ${identity}\nDefinition ${definition}` : `Composition ${identity}`}${unresolvedParent ? '\nParent unavailable' : ''}`,
				displayLabel: '', labelClipped: false,
			}, previousMember !== undefined && previousMember.element.kind === 'member'
				&& previousMember.element.span.end === memberSpan.end && previousMember.collapsed);
			nodes.set(entry, member);
			input.outlineRanges.set(member.element, member.element.span);
			const descendants = children.get(entry);
			if (descendants !== undefined) for (let child = descendants.length - 1; child >= 0; child--) pending.push(descendants[child]);
		}
	}
	rebuildWorkbenchTreeRows(outline, null);
	input.outlineGeneration++;
	input.outlineParentGeneration = input.authoring.spatialGeneration;
	projectSceneSelection(input);
}

/** Bind only the selected source member; a definition is never a fake member. */
export function selectSceneOutlineRow(input: SceneHierarchyViewState, index: number): boolean {
	const row = input.outline.rows[index]?.element;
	if (!input.authoring.select(input.outlineDocument!, input.outlineSourceVersion, row === undefined ? undefined : row.kind === 'scene'
		? { kind: 'scene', scene: row.scene } : { kind: 'member', scene: row.scene, entry: row.entry, index: row.index })) return false;
	projectSceneSelection(input);
	return true;
}

/** Project the domain's admitted selection; this does not select or re-admit old row syntax. */
export function projectSceneSelection(input: SceneHierarchyViewState): void {
	const selection = input.authoring.selection, document = input.authoring.document;
	input.outline.selectionIndex = selection === undefined ? -1 : input.outline.rows.findIndex(row => row.element.scene === selection.scene
		&& (selection.kind === 'scene' ? row.element.kind === 'scene'
			: row.element.kind === 'member' && row.element.entry === selection.entry));
	input.outline.hoverIndex = -1;
	input.outlineRevision = input.outlineDocument === document && input.outlineSourceVersion === input.authoring.workingCopy.version
		? input.authoring.revision : -1;
}
