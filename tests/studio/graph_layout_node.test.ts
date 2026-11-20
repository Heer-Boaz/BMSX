import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';

const graph = { id: 'test', children: [{ id: 'a', width: 12, height: 12 }, { id: 'b', width: 12, height: 12 }],
	edges: [{ id: 'edge', sources: ['a'], targets: ['b'] }], layoutOptions: { 'elk.algorithm': 'layered' } };

test('Node layout uses a real reusable thread and rejects pending/future work when disposed', async () => {
	const worker = new Worker(resolve('ide/node/graph_layout_worker.cjs'));
	const engine = new NodeGraphLayoutEngine(worker);
	const result = await engine.layout(graph);
	assert.equal(result.edges![0].sections!.length, 1);
	assert.notEqual(result.children![0].x, result.children![1].x);
	const pending = engine.layout(graph);
	const stopped = new Promise<void>(resolve => worker.once('exit', () => resolve()));
	engine.dispose();
	await assert.rejects(pending, /disposed/);
	await stopped;
	await assert.rejects(engine.layout(graph), /disposed/);
});

test('Node worker load failure settles admitted work, retaining the actual cause', async () => {
	const worker = new Worker(resolve('ide/node/does-not-exist.cjs'));
	const engine = new NodeGraphLayoutEngine(worker);
	try {
		await assert.rejects(engine.layout(graph), error => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /failed to load or execute/);
			assert.ok(error.cause instanceof Error);
			return true;
		});
	} finally { engine.dispose(); }
});

test('Node registration failure terminates the native queue before late layout replies can reenter it', async () => {
	const worker = new Worker(`const { parentPort } = require('node:worker_threads');
	parentPort.on('message', request => parentPort.postMessage(request.id === 0
		? { id: 0, error: 'deliberate registration rejection' } : { id: request.id, data: request.graph }));`, { eval: true });
	const engine = new NodeGraphLayoutEngine(worker);
	try {
		const stopped = new Promise<void>(resolve => worker.once('exit', () => resolve()));
		await assert.rejects(engine.layout(graph), /algorithm registration failed/);
		await stopped;
		await assert.rejects(engine.layout(graph), /algorithm registration failed/);
	} finally { engine.dispose(); }
});
