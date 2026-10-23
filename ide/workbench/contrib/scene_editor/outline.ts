import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { luaSourceRangeToTextRange, readLuaExpressionPreview, readLuaSourceRange, readLuaTableFieldInteger } from '../../../language/lua/source_edits';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { SceneSourceDefinition, SceneSourceDocument, SceneSourceEntry } from './model';
import type { SceneEditorInput } from './editor_input';
import { collectSceneOptionProperties } from './option_properties';

type SceneOutlineSource = {
	readonly scene: SceneSourceDefinition;
	readonly source: LuaSourceRange;
	readonly span: TrackedTextRange;
	readonly label: string;
	readonly detail: string;
	readonly identity: string;
	displayLabel: string;
	labelClipped: boolean;
};
export type SceneMemberElement = SceneOutlineSource & { readonly kind: 'member'; readonly entry: SceneSourceEntry; readonly index: number };
export type SceneOutlineElement = SceneOutlineSource & { readonly kind: 'scene' } | SceneMemberElement;

/** Source correspondence belongs to this outline, not to labels or the generic tree. */
export function installSceneOutline(input: SceneEditorInput, document: SceneSourceDocument): void {
	input.document = document;
	const { outline, workingCopy: { buffer } } = input;
	const previous = new Map<number, WorkbenchTreeNode<SceneOutlineElement>>();
	for (const root of outline.roots) {
		if (root.element.span.start !== root.element.span.end) previous.set(root.element.span.start, root);
	}
	outline.roots.length = 0;
	for (const scene of document.scenes) {
		const span = luaSourceRangeToTextRange(buffer, scene.range);
		const prior = previous.get(span.start);
		const locations = document.analysis.chunk.locations;
		const sceneIdentity = readLuaSourceRange(buffer, locations.range(scene.id.span));
		const detail = `${scene.objects.length} MEMBERS${scene.resolution === 'partial' ? ' (PARTIAL)' : ''}`;
		const root = appendWorkbenchTreeNode(outline, null, {
			kind: 'scene', scene, source: scene.range, span,
			label: readLuaExpressionPreview(buffer, locations, scene.id), detail,
			identity: `${sourceTabDescription(input.workingCopy.resource)}:${scene.range.start.line}:${scene.range.start.column}\nScene ${sceneIdentity}\n${detail}`,
			displayLabel: '', labelClipped: false,
		}, prior !== undefined && prior.element.span.end === span.end && prior.collapsed);
		for (let index = 0; index < scene.objects.length; index += 1) {
			const entry = scene.objects[index];
			const range = locations.range(entry.field.span);
			const expression = entry.kind === 'object' ? entry.memberId : entry.field.value;
			const identity = readLuaSourceRange(buffer, locations.range(expression.span));
			const definition = entry.kind === 'object' ? readLuaSourceRange(buffer, locations.range(entry.definitionId.span)) : '';
			appendWorkbenchTreeNode(outline, root, {
				kind: 'member', scene, entry, index, source: range,
				span: luaSourceRangeToTextRange(buffer, range),
				label: readLuaExpressionPreview(buffer, locations, expression),
				detail: entry.kind === 'object' ? readLuaExpressionPreview(buffer, locations, entry.definitionId) : 'Dynamic Lua composition',
				identity: `${sourceTabDescription(input.workingCopy.resource)}:${range.start.line}:${range.start.column}\nScene ${sceneIdentity}\n${entry.kind === 'object' ? `Member ${identity}\nDefinition ${definition}` : `Composition ${identity}`}`,
				displayLabel: '', labelClipped: false,
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
	input.optionProperties = row?.kind === 'member' && row.entry.kind === 'object'
		? collectSceneOptionProperties(input.workingCopy.buffer, input.document.analysis.chunk.locations, row.entry) : [];
	for (const property of input.properties) {
		const field = row?.kind === 'member' && row.entry.kind === 'object' && row.entry.position !== null
			? row.entry.position[property.axis] : null;
		property.field = field;
		property.value = field === null ? null : readLuaTableFieldInteger(field);
		property.sourceText = field === null ? 'Lua source' : readLuaSourceRange(input.workingCopy.buffer, input.document.analysis.chunk.locations.range(field.value.span)).replace(/\s+/g, ' ');
	}
}
