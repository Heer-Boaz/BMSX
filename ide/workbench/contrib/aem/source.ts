import { isMap, isSeq, isScalar, type Node, type Pair } from 'yaml';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { parseStructuredSource, type StructuredCollection } from '../../../language/yaml/structured_edits';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { AemEditorInput, AemProperty } from './editor_input';
import type { AemSourceIdentity, AemSourceRole } from './source_selection';

/** A generation of authored YAML / JSON nodes; no cooked event-map reconstruction. */
export function projectAemSource(input: AemEditorInput): void {
	const model = input.workingCopy;
	if (input.version === model.version) return;
	input.version = model.version;
	input.source = model.buffer.getText();
	const tree = input.tree;
	const selection = input.sourceSelection;
	const collapsed = new Set<AemSourceIdentity>();
	const remember = (nodes: readonly WorkbenchTreeNode<AemProperty>[]) => {
		for (const node of nodes) { if (node.collapsed) collapsed.add(node.element.sourceIdentity); remember(node.children); }
	};
	remember(tree.roots);
	selection.beginProjection();
	tree.roots.length = 0;
	input.document = undefined;
	try { input.document = parseStructuredSource(input.source, aemDocumentFormat(model.resource.path)); }
	catch (error) {
		tree.rows.length = 0; tree.selectionIndex = -1;
		selection.publish();
		input.status = `Source syntax: ${error instanceof Error ? error.message : String(error)}`;
		return;
	}
	const append = (node: Node, path: readonly (string | number)[], label: string, parent: WorkbenchTreeNode<AemProperty> | null,
		role: AemSourceRole, container?: StructuredCollection, index?: number, event?: AemSourceIdentity, keyRange?: readonly number[]): void => {
		const collection = isMap(node) || isSeq(node);
		const key = JSON.stringify(path);
		const identity = selection.acquire(role, keyRange === undefined ? node.range![0] : keyRange[0],
			keyRange === undefined ? Math.min(node.range![1], node.range![0] + 1) : keyRange[1]);
		if (role === 'event') identity.eventSection = parent!.element.sourceIdentity;
		const selectedEvent = role === 'event' ? identity : event;
		let value = '';
		if (!collection) value = input.source.slice(node.range![0], node.range![1]);
		else if (node.items.length === 0) value = isMap(node) ? '{}' : '[]';
		const element: AemProperty = { kind: collection ? 'group' : 'property', label, key, path, node, parent: container, index,
			sourceIdentity: identity, event: selectedEvent, eventName: role === 'event' ? label : undefined,
			value, inlineEditable: isScalar(node) && !/[\r\n]/.test(value),
			description: '', warning: false,
			displayLabel: '', displayValue: '', displayValueLeft: 0 };
		identity.property = element;
		const row = appendWorkbenchTreeNode(tree, parent, element, collapsed.has(identity), identity);
		if (isMap(node)) for (let i = 0; i < node.items.length; i++) {
			const pair = node.items[i] as Pair<Node, Node | null>;
			if (pair.value === null) continue;
			const key = isScalar(pair.key) ? String(pair.key.value) : input.source.slice(pair.key.range![0], pair.key.range![1]);
			append(pair.value, [...path, key], key, row, path.length === 1 && path[0] === 'events' ? 'event' : 'property',
				node as StructuredCollection, i, selectedEvent, pair.key.range!);
		} else if (isSeq(node)) for (let i = 0; i < node.items.length; i++) {
			const child = node.items[i] as Node | null;
			if (child !== null) append(child, [...path, i], `[${i + 1}]`, row, 'item', node as StructuredCollection, i, selectedEvent);
		}
	};
	if (input.document.contents !== null) append(input.document.contents, [], 'Map', null, 'root');
	selection.publish();
	let selected: WorkbenchTreeNode<AemProperty> | null = null;
	const findSelected = (nodes: readonly WorkbenchTreeNode<AemProperty>[]) => {
		for (const node of nodes) {
			if (node.element.sourceIdentity === selection.selected) selected = node;
			findSelected(node.children);
		}
	};
	findSelected(tree.roots);
	rebuildWorkbenchTreeRows(tree, selected);
	tree.textDirty = true;
	input.status = '';
}
