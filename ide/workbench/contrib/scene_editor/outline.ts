import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { readLuaSourceRange, readLuaTableFieldInteger } from '../../../language/lua/source_edits';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry } from './model';
import type { SceneEditorInput } from './editor_input';

type SceneOutlineSource = {
	readonly scene: SceneSourceDefinition;
	readonly source: LuaSourceRange;
	readonly span: TrackedTextRange;
	readonly label: string;
	readonly detail: string;
	displayLabel: string;
};
export type SceneMemberElement = SceneOutlineSource & { readonly kind: 'member'; readonly entry: SceneSourceEntry; readonly index: number };
export type SceneOutlineElement = SceneOutlineSource & { readonly kind: 'scene' } | SceneMemberElement;

/** Source correspondence belongs to this outline, not to labels or the generic tree. */
export function installSceneOutline(input: SceneEditorInput, document: SceneSourceDocument): void {
	const { outline, workingCopy: { buffer } } = input;
	const previous = new Map<number, WorkbenchTreeNode<SceneOutlineElement>>();
	for (const root of outline.roots) {
		if (root.element.span.start !== root.element.span.end) previous.set(root.element.span.start, root);
	}
	outline.roots.length = 0;
	for (const scene of document.scenes) {
		const span = {
			start: buffer.offsetAt(scene.range.start.line - 1, scene.range.start.column - 1),
			end: buffer.offsetAt(scene.range.end.line - 1, scene.range.end.column),
		};
		const prior = previous.get(span.start);
		const root = appendWorkbenchTreeNode(outline, null, {
			kind: 'scene', scene, source: scene.range, span,
			label: readLuaSourceRange(buffer, scene.id.range).replace(/\s+/g, ' '),
			detail: `${scene.objects.length} MEMBERS${scene.resolution === 'partial' ? ' (PARTIAL)' : ''}`, displayLabel: '',
		}, prior !== undefined && prior.element.span.end === span.end && prior.collapsed);
		for (let index = 0; index < scene.objects.length; index += 1) {
			const entry = scene.objects[index];
			const range = entry.field.range;
			appendWorkbenchTreeNode(outline, root, {
				kind: 'member', scene, entry, index, source: range,
				span: { start: buffer.offsetAt(range.start.line - 1, range.start.column - 1), end: buffer.offsetAt(range.end.line - 1, range.end.column) },
				label: readLuaSourceRange(buffer, entry.kind === 'object' ? entry.memberId.range : entry.field.value.range).replace(/\s+/g, ' '),
				detail: entry.kind === 'object' ? readLuaSourceRange(buffer, entry.definitionId.range).replace(/\s+/g, ' ') : 'Dynamic Lua composition',
				displayLabel: '',
			});
		}
	}
	rebuildWorkbenchTreeRows(outline, null);
	let selectionIndex = -1;
	for (let index = 0; index < outline.rows.length; index += 1) {
		const span = outline.rows[index].element.span;
		if (span.start === input.selectionRange.start && span.end === input.selectionRange.end) selectionIndex = index;
	}
	if (input.version === 0 && outline.rows.length > 0) selectionIndex = 0;
	selectSceneOutlineRow(input, selectionIndex);
}

/** Bind only the selected source member; a definition is never a fake member. */
export function selectSceneOutlineRow(input: SceneEditorInput, index: number): void {
	input.outline.selectionIndex = index;
	input.outline.hoverIndex = -1;
	const row = input.outline.rows[index]?.element;
	input.selectionRange.start = row === undefined ? 0 : row.span.start;
	input.selectionRange.end = row === undefined ? 0 : row.span.end;
	for (const property of input.properties) {
		const field = row?.kind === 'member' && row.entry.kind === 'object' && row.entry.position !== null
			? row.entry.position[property.axis] : null;
		property.field = field;
		property.value = field === null ? null : readLuaTableFieldInteger(field);
		property.sourceText = field === null ? 'Lua source' : readLuaSourceRange(input.workingCopy.buffer, field.value.range).replace(/\s+/g, ' ');
	}
}
