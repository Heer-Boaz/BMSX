import assert from 'node:assert/strict';
import test from 'node:test';
import ELK, { type ElkLayoutArguments, type ElkNode } from 'elkjs/lib/elk.bundled';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import type { RectBounds } from '../../machine/ts/common/rect';
import { layoutWorkbenchCompoundGraph } from '../../ide/workbench/ui/graph/compound_layout';
import { compoundGraphFixture, type CompoundFixtureNode } from '../helpers/compound_graph_fixture';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';
import { createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';

const font = new Font({ variant: 'tiny' });
class RecordedEngine extends ELK {
	public input: ElkNode;
	public output: ElkNode;
	public override async layout<T extends ElkNode>(graph: T, args?: ElkLayoutArguments) {
		this.input = structuredClone(graph);
		const output = await super.layout(graph, args);
		this.output = output;
		return output;
	}
}
const engine = new RecordedEngine({ algorithms: ['layered'] });
async function fixture() {
	const graph = compoundGraphFixture(font);
	const model = await layoutWorkbenchCompoundGraph(font, graph.roots, graph.links, engine);
	const view = new WorkbenchGraphViewport(model);
	view.layout(0, 0, 384, 288);
	return { ...graph, model, view };
}
function overlap(a: RectBounds, b: RectBounds): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function onBoundary(x: number, y: number, bounds: RectBounds): boolean {
	return ((x === bounds.left || x === bounds.right) && y >= bounds.top && y <= bounds.bottom)
		|| ((y === bounds.top || y === bounds.bottom) && x >= bounds.left && x <= bounds.right);
}

test('compound layout sends only geometry, retaining domain objects and distinct binary edge proofs', async () => {
	const { model, links, roots, nodes } = await fixture();
	assert.equal(model.nodes.length, 8);
	assert.equal(model.edges.length, links.length);
	assert.equal(model.nodes[0], roots[0]);
	assert.equal(model.nodes[0].action(), 'MACHINE');
	const inputText = JSON.stringify(engine.input);
	assert.ok(!inputText.includes('proof') && !inputText.includes('action') && !inputText.includes('headerHeight'));
	assert.equal(engine.input.children![0].children!.length, 3, 'containment is not flattened before ELK');
	assert.equal(engine.input.edges!.length, links.length);
	assert.equal(engine.input.layoutOptions!['elk.layered.mergeEdges'], 'false');
	for (const edge of model.edges) {
		assert.ok(links.includes(edge.link), 'edge proof is the actual input object, not a copied name');
		assert.equal(edge.labels.map(label => label.lines.join('\n')).join(''), edge.link.label);
		assert.equal(edge.arrow.length, 6);
		assert.ok(onBoundary(edge.points[0], edge.points[1], edge.link.source.bounds), edge.link.proof + ' origin');
		assert.ok(onBoundary(edge.points.at(-2)!, edge.points.at(-1)!, edge.link.target.bounds), edge.link.proof + ' target');
	}
	for (const edge of engine.output.edges!) assert.equal(edge.sections!.length, 1, 'binary Layered edges rejoin after compound routing');
	assert.ok(new Set(engine.output.edges!.map(edge => edge.container)).size >= 3, 'routes use distinct nested coordinate systems');
	for (const node of model.nodes) assert.equal(nodes.get(node.name), node);
});

test('containment, title space, labels, and sibling separation use the same measured geometry', async () => {
	const { model } = await fixture();
	for (const node of model.nodes) {
		for (const child of node.children) {
			assert.ok(child.bounds.left > node.bounds.left && child.bounds.right < node.bounds.right);
			assert.ok(child.bounds.top > node.bounds.top + node.headerHeight && child.bounds.bottom < node.bounds.bottom);
			assert.ok(model.nodes.indexOf(node) < model.nodes.indexOf(child), 'parent-before-child paint order');
		}
		for (let i = 0; i < node.children.length; i += 1) {
			for (let j = i + 1; j < node.children.length; j += 1) assert.ok(!overlap(node.children[i].bounds, node.children[j].bounds));
		}
	}
	const labels = model.edges.flatMap(edge => edge.labels);
	for (let i = 0; i < labels.length; i += 1) {
		const label = labels[i];
		assert.equal(label.bounds.right - label.bounds.left, font.measure(label.lines[0]) + 4);
		for (const node of model.nodes) assert.ok(!overlap(label.bounds, { ...node.bounds, bottom: node.bounds.top + node.headerHeight }), 'label does not cover a card/header');
		for (let j = i + 1; j < labels.length; j += 1) assert.ok(!overlap(label.bounds, labels[j].bounds), 'parallel edge labels have independent positions');
	}
});

test('parallel labels with identical text select their own edges; container interiors remain pan targets', async () => {
	const { model, view, nodes } = await fixture();
	const parallel = model.edges.filter(edge => edge.link.proof === 'start' || edge.link.proof === 'retry');
	assert.notDeepEqual(parallel[0].points, parallel[1].points);
	for (const edge of model.edges) {
		if (edge.labels.length === 0) continue;
		const label = edge.labels[0];
		view.scrollX = label.bounds.left - 100;
		view.scrollY = label.bounds.top - 100;
		assert.equal(view.hitTest(101, 101), edge, edge.link.proof);
	}
	const root = nodes.get('MACHINE')!;
	view.scrollX = root.bounds.left - 10;
	view.scrollY = root.bounds.top - 10;
	assert.equal(view.hitTest(11, 11), root, 'only the header is a root node hit');
	assert.equal(view.hitTest(12, root.headerHeight + 16), null, 'unoccupied compound body is not a node hit');
	view.scrollY = root.bounds.bottom;
	view.reveal(root);
	assert.equal(view.scrollY, root.bounds.top - 6, 'reveal follows the title, not the potentially huge body');
});

test('layout is deterministic across independent generations, including cycles and root self-loops', async () => {
	const a = await fixture();
	const b = await fixture();
	assert.deepEqual(a.model.nodes.map(node => node.bounds), b.model.nodes.map(node => node.bounds));
	assert.deepEqual(a.model.edges.map(edge => [edge.link.proof, edge.points, edge.labels]),
		b.model.edges.map(edge => [edge.link.proof, edge.points, edge.labels]));
	for (const edge of a.model.edges) {
		for (let offset = 0; offset + 3 < edge.points.length; offset += 2) {
			assert.ok(edge.points[offset] === edge.points[offset + 2] || edge.points[offset + 1] === edge.points[offset + 3], 'orthogonal route');
		}
	}
});

test('empty, disconnected, multiline and long compound headers use the declared size instead of a fitting fallback', async () => {
	const empty = await layoutWorkbenchCompoundGraph(font, [], [], engine);
	assert.equal(empty.nodes.length, 0);
	assert.equal(empty.edges.length, 0);
	const leaf: CompoundFixtureNode = { ...createWorkbenchGraphNode(font, 'A', 0, 0), children: [], name: 'a', action: () => 'a' };
	const title = 'LONG AUTHORED CONTAINER NAME';
	const group: CompoundFixtureNode = { ...createWorkbenchGraphNode(font, title + '\nSECOND LINE', 0, 0), children: [leaf], name: 'group', action: () => 'group' };
	const other: CompoundFixtureNode = { ...createWorkbenchGraphNode(font, 'OTHER', 0, 0), children: [], name: 'other', action: () => 'other' };
	const graph = await layoutWorkbenchCompoundGraph(font, [group, other], [], engine);
	assert.equal(graph.nodes.length, 3);
	assert.ok(group.bounds.right - group.bounds.left >= font.measure(title) + 8);
	assert.equal(group.headerHeight, font.lineHeight * 2 + 8);
	assert.ok(!overlap(group.bounds, other.bounds));
});

test('engine failure is exposed; no alternate layout, empty success or mutation rollback is attempted', async () => {
	const graph = compoundGraphFixture(font);
	const before = [...graph.nodes.values()].map(node => ({ ...node.bounds }));
	const failure = new Error('layout engine failure');
	let calls = 0;
	await assert.rejects(layoutWorkbenchCompoundGraph(font, graph.roots, graph.links, {
		layout: async () => { calls += 1; throw failure; },
	}), error => error === failure);
	assert.equal(calls, 1);
	assert.deepEqual([...graph.nodes.values()].map(node => node.bounds), before, 'geometry writes begin only after layout, not before sending it');
});
