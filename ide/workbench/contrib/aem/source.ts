import { isMap, isSeq, isScalar, type Node, type Pair } from 'yaml';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { parseStructuredSource, type StructuredCollection } from '../../../language/yaml/structured_edits';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { AemEditorInput, AemProperty } from './editor_input';

/** A generation of authored YAML / JSON nodes; no cooked event-map reconstruction. */
export function projectAemSource(input: AemEditorInput): void {
	const model = input.workingCopy;
	if (input.version === model.version) return;
	input.version = model.version;
	input.source = model.buffer.getText();
	const tree = input.tree;
	const selectedKey = tree.rows[tree.selectionIndex]?.element.key;
	const collapsed = new Set<string>();
	const remember = (nodes: readonly WorkbenchTreeNode<AemProperty>[]) => {
		for (const node of nodes) { if (node.collapsed) collapsed.add(node.element.key); remember(node.children); }
	};
	remember(tree.roots);
	tree.roots.length = 0;
	input.document = undefined;
	try { input.document = parseStructuredSource(input.source, aemDocumentFormat(model.resource.path)); }
	catch (error) {
		tree.rows.length = 0; tree.selectionIndex = -1;
		input.status = `Source syntax: ${error instanceof Error ? error.message : String(error)}`;
		return;
	}
	let selected: WorkbenchTreeNode<AemProperty> | null = null;
	const append = (node: Node, path: readonly (string | number)[], label: string, parent: WorkbenchTreeNode<AemProperty> | null,
		container?: StructuredCollection, index?: number): void => {
		const collection = isMap(node) || isSeq(node);
		const key = JSON.stringify(path);
		const value = collection ? `${node.items.length} ${isMap(node) ? 'properties' : 'entries'}` : input.source.slice(node.range![0], node.range![1]);
		const element: AemProperty = { kind: collection ? 'group' : 'property', label, key, path, node, parent: container, index,
			value, inlineEditable: isScalar(node) && !/[\r\n]/.test(value),
			description: `/${path.join('/')} / ${node.range![0]}..${node.range![1]}`, warning: false,
			displayLabel: '', displayValue: '', displayValueLeft: 0 };
		const row = appendWorkbenchTreeNode(tree, parent, element, collapsed.has(key));
		if (key === selectedKey) selected = row;
		if (isMap(node)) for (let i = 0; i < node.items.length; i++) {
			const pair = node.items[i] as Pair<Node, Node | null>;
			if (pair.value === null) continue;
			const key = isScalar(pair.key) ? String(pair.key.value) : input.source.slice(pair.key.range![0], pair.key.range![1]);
			append(pair.value, [...path, key], key, row, node as StructuredCollection, i);
		} else if (isSeq(node)) for (let i = 0; i < node.items.length; i++) {
			const child = node.items[i] as Node | null;
			if (child !== null) append(child, [...path, i], `[${i + 1}]`, row, node as StructuredCollection, i);
		}
	};
	if (input.document.contents !== null) append(input.document.contents, [], 'AUDIO EVENT MAP', null);
	rebuildWorkbenchTreeRows(tree, selected);
	tree.textDirty = true;
	input.status = 'Authored audio events / Save validates and applies through the AEM owner';
}
