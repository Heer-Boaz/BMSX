import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutWorkbenchTree, type WorkbenchTreeNode } from '../../ide/workbench/ui/graph/tree_layout';

function card(width: number, height: number, children: WorkbenchTreeNode[] = []): WorkbenchTreeNode {
	return { bounds: { left: 0, top: 0, right: width, bottom: height }, children };
}

function assertLayout(root: WorkbenchTreeNode): void {
	const levels: WorkbenchTreeNode[][] = [[root]];
	for (let depth = 0; depth < levels.length; depth += 1) {
		const row = levels[depth];
		const children: WorkbenchTreeNode[] = [];
		for (let index = 0; index < row.length; index += 1) {
			const node = row[index];
			if (index > 0) assert.ok(row[index - 1].bounds.right + 15 <= node.bounds.left, 'same-depth cards do not overlap');
			if (node.children.length > 0) {
				const first = node.children[0].bounds;
				const last = node.children[node.children.length - 1].bounds;
				assert.ok(Math.abs((node.bounds.left + node.bounds.right) / 2 - (first.left + first.right + last.left + last.right) / 4) <= 1);
			}
			for (const child of node.children) {
				assert.ok(child.bounds.top >= node.bounds.bottom + 24, 'routes have room below every variable-height parent');
				children.push(child);
			}
		}
		if (children.length > 0) levels.push(children);
	}
}

test('tidy tree uses measured variable widths/heights and keeps authored sibling order', () => {
	const root = card(54, 15, [card(42, 70, [card(180, 16), card(19, 40)]),
		card(11, 20), card(63, 36, [card(14, 14, [card(122, 24)]), card(202, 32)])]);
	const order = [...root.children];
	layoutWorkbenchTree(root, 16, 24);
	assertLayout(root);
	assert.deepEqual(root.children, order);
	assert.equal(root.bounds.right - root.bounds.left, 54);
	assert.equal(root.children[0].bounds.bottom - root.children[0].bounds.top, 70);
	const positions = JSON.stringify(root);
	layoutWorkbenchTree(root, 16, 24);
	assert.equal(JSON.stringify(root), positions, 'repeat layout does not accumulate offsets or change card measurements');
});

test('tidy contours keep asymmetric, wide and deep authored forests separated', () => {
	for (let seed = 1; seed <= 12; seed += 1) {
		const nodes = Array.from({ length: 512 }, (_, index) => card(16 + ((index * seed * 17) % 180), 14 + ((index * 7) % 40)));
		for (let index = 1; index < nodes.length; index += 1) {
			const parent = ((index - 1) / (seed % 4 + 2)) | 0;
			(nodes[parent].children as WorkbenchTreeNode[]).push(nodes[index]);
		}
		layoutWorkbenchTree(nodes[0], 16, 24);
		assertLayout(nodes[0]);
	}
});

test('layout traversal is iterative and does not shift every descendant for each ancestor', () => {
	let root = card(40, 14);
	for (let depth = 0; depth < 10000; depth += 1) root = card(40, 14, [card(24, 14), root]);
	layoutWorkbenchTree(root, 16, 24);
	let tail = root;
	for (let depth = 0; depth < 10000; depth += 1) tail = tail.children[1];
	assert.equal(tail.bounds.top, 10000 * 38);
});
