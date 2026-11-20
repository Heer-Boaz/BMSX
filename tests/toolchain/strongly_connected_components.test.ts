import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stronglyConnectedComponents, type StronglyConnectedNode } from '../../toolchain/ts/collections/strongly_connected_components';

type Node = StronglyConnectedNode<Node> & { readonly id: number; readonly dependencies: Node[] };

function graph(edges: readonly (readonly number[])[]): Node[] {
	const nodes: Node[] = edges.map((_, id) => ({ id, dependencies: [], index: -1, lowlink: 0, component: -1, active: false }));
	for (let index = 0; index < edges.length; index += 1) {
		for (const target of edges[index]) nodes[index].dependencies.push(nodes[target]);
	}
	return nodes;
}

test('SCC traversal emits dependencies before consumers and groups only cycles', () => {
	const nodes = graph([[1, 3], [2], [1, 3], [], [4]]);
	const components = stronglyConnectedComponents(nodes);
	assert.deepEqual(components.map(component => component.map(node => node.id).sort()), [[3], [1, 2], [0], [4]]);
	for (const node of nodes) {
		assert.equal(node.active, false);
		assert.ok(node.dependencies.every(target => target.component <= node.component));
	}
});

test('SCC traversal handles already visited cross edges without merging components', () => {
	const nodes = graph([[1, 2], [3], [3], []]);
	assert.deepEqual(stronglyConnectedComponents(nodes).map(component => component.map(node => node.id)), [[3], [1], [2], [0]]);
});

test('SCC traversal follows long chains and cycles without using the host call stack', () => {
	const count = 20000;
	for (const cyclic of [false, true]) {
		const nodes = graph(Array.from({ length: count }, (_, index) => index + 1 < count ? [index + 1] : cyclic ? [0] : []));
		const components = stronglyConnectedComponents([nodes[0]]);
		assert.equal(components.length, cyclic ? 1 : count);
		assert.equal(components[0].length, cyclic ? count : 1);
		assert.equal(components[0][0], nodes[count - 1]);
	}
});

test('SCC traversal accepts an empty graph', () => {
	assert.deepEqual(stronglyConnectedComponents<Node>([]), []);
});
