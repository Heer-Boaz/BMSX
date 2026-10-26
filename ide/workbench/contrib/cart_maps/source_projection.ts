import type { EditorEditSource } from '../../../editor/model/edit_state';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import { buildPietiousSource, createPietiousPositionEdit } from './pietious_source';
import { buildNemesisSource, createNemesisMarkerMoveEdit } from './nemesis_source';
import { cartMapEditSelection, type CartMapInput, type CartMapItem, type CartMapSheet, type CartMapTreeElement } from './editor_input';
import type { EditorModelEdit } from '../../../editor/model/text_model';
import { mapTextOffset } from '../../../editor/text/text_change';

/** Rebuild presentation only when authored text changes. Domains keep their own source models. */
export function projectCartMap(input: CartMapInput): void {
	const model = input.workingCopy;
	if (input.version === model.version) return;
	const initial = input.version === -1;
	input.version = model.version;
	const source = model.buffer.getText(), tree = input.tree;
	const collapsed = new Set(tree.roots.filter(root => root.collapsed).map(root => root.element.sheet.key));
	tree.roots.length = 0;
	const append = (sheet: CartMapSheet, label: string, diagnostic: string | null) => appendWorkbenchTreeNode(tree, null,
		{ sheet, label, displayLabel: '', range: sheet.range, diagnostic }, collapsed.has(sheet.key) || initial && tree.roots.length > 0);
	if (input.mapKind === 'pietious') {
		const document = buildPietiousSource(source, model.version);
		input.diagnostic = document.diagnostic;
		for (const room of document.rooms) {
			const markers: CartMapItem[] = [];
			for (const object of room.objects) if (object.editable) markers.push({ kind: 'object', document,
				source: object, x: object.x!, y: object.y!, glyph: object.type.slice(0, 1) });
			const sheet: CartMapSheet = { key: room.id, rows: room.rows, width: room.width, markers, range: { ...room.range } };
			const root = append(sheet, `ROOM ${room.id}`, room.diagnostic);
			let markerIndex = 0;
			for (const object of room.objects) {
				appendWorkbenchTreeNode(tree, root, { sheet, label: `${object.index + 1}. ${object.type}`, displayLabel: '',
					range: object.range, item: object.editable ? markers[markerIndex++] : undefined, diagnostic: object.diagnostic });
			}
		}
	} else {
		const document = buildNemesisSource(source, model.version);
		input.diagnostic = document.diagnostic;
		if (input.diagnostic === null) for (const row of document.rows) {
			if (row.diagnostic !== null) { input.diagnostic = row.diagnostic; break; }
		}
		const markers: CartMapItem[] = document.markers.map(marker => ({ ...marker, kind: 'marker', document, source: marker }));
		const sheet: CartMapSheet = { key: 'stage', rows: document.rows.map(row => row.glyphs), width: document.width,
			markers, range: { start: 0, end: source.length } };
		const root = append(sheet, 'STAGE', document.diagnostic);
		for (const item of markers) appendWorkbenchTreeNode(tree, root, { sheet, item,
			label: `${item.glyph} (${item.x}, ${item.y})`, displayLabel: '', range: item.source.range, diagnostic: null });
	}
	let selected: WorkbenchTreeNode<CartMapTreeElement> | null = null;
	for (const root of tree.roots) {
		for (const node of [root, ...root.children]) {
			const span = node.element.range;
			if (input.selectionRange.start !== input.selectionRange.end && span.start === input.selectionRange.start && span.end === input.selectionRange.end) {
				selected = node;
				if (node.parent !== null) node.parent.collapsed = false;
			}
		}
	}
	if (initial && tree.roots.length > 0) selected = tree.roots[0];
	input.grid.content = tree.roots.find(root => root.element.sheet.key === input.activeSheet)?.element.sheet;
	rebuildWorkbenchTreeRows(tree, selected);
	selectCartMapRow(input, tree.selectionIndex);
}

export function selectCartMapRow(input: CartMapInput, index: number): void {
	input.tree.selectionIndex = index;
	const element = input.tree.rows[index]?.element;
	input.selectionRange.start = element === undefined ? 0 : element.range.start;
	input.selectionRange.end = element === undefined ? 0 : element.range.end;
	if (element !== undefined) {
		input.activeSheet = element.sheet.key;
		input.grid.content = element.sheet;
	}
	input.grid.selected = element?.item;
	input.viewRevision++;
}

/** A coordinate edit belongs to the actual authored representation, never to a cooked actor. */
export function createCartMapMove(item: CartMapItem, x: number, y: number, source: EditorEditSource): EditorModelEdit {
	let edit: EditorModelEdit;
	let selection = item.source.range;
	switch (item.kind) {
		case 'object': edit = createPietiousPositionEdit(item.document, item.source, x, y); break;
		case 'marker': {
			edit = createNemesisMarkerMoveEdit(item.document, item.source, y, x);
			const row = item.document.rows[y], offset = row.columns[x];
			selection = { start: row.cells!.offsets[offset]!, end: row.cells!.offsets[offset + 1]! };
			break;
		}
	}
	// Explicit moves carry their selection through the document's existing edit
	// history. Unrelated source replacements still clear tracked source identity.
	return { ...edit, beforeEditState: cartMapEditSelection.of({ ...item.source.range }, source), computeAfterEditState: changes => cartMapEditSelection.of({
		start: mapTextOffset(selection.start, changes, 1), end: mapTextOffset(selection.end, changes, -1),
	}, source) };
}
