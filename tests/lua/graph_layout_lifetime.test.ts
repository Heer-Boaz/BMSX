import assert from 'node:assert/strict';
import test from 'node:test';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { DisposableStore } from '../../ide/common/lifecycle';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { AsyncGraphLayout } from '../../ide/workbench/services/graph_layout/async_layout';
import type { GraphLayoutEngine } from '../../ide/workbench/services/graph_layout/engine';
import { createWorkbenchGraphModel } from '../../ide/workbench/ui/graph/model';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { GraphLayoutTestInput } from '../helpers/graph_layout_input';

const font = new Font({ variant: 'tiny' });
type Model = ReturnType<typeof createWorkbenchGraphModel> & { generation: number };

class ControlledEngine implements GraphLayoutEngine {
	public readonly calls: string[] = [];
	private readonly jobs = new Map<string, ReturnType<typeof Promise.withResolvers<ElkNode>>>();
	public disposals = 0;
	public readonly closeError = new Error('test engine closed');

	public layout(graph: ElkNode): Promise<ElkNode> {
		this.calls.push(graph.id);
		const job = Promise.withResolvers<ElkNode>();
		this.jobs.set(graph.id, job);
		return job.promise;
	}
	public complete(id: number): void {
		const key = String(id);
		const job = this.jobs.get(key)!;
		this.jobs.delete(key);
		job.resolve({ id: key });
	}
	public fail(id: number, error: unknown): void {
		const key = String(id);
		const job = this.jobs.get(key)!;
		this.jobs.delete(key);
		job.reject(error);
	}
	public dispose(): void {
		this.disposals += 1;
		for (const job of this.jobs.values()) job.reject(this.closeError);
		this.jobs.clear();
	}
}

function request(session: AsyncGraphLayout<Model>, generation: number): void {
	session.request(async engine => {
		await engine.layout({ id: String(generation) });
		return { ...createWorkbenchGraphModel(font, [], []), generation };
	});
}

test('layout is lazy; an unopened input can close without constructing an engine', () => {
	let constructed = 0;
	const session = new AsyncGraphLayout(() => { constructed += 1; return new ControlledEngine(); });
	assert.deepEqual(session.state, { kind: 'idle' });
	session.dispose();
	session.dispose();
	assert.equal(constructed, 0);
	assert.equal(session.state.kind, 'disposed');
	assert.throws(() => session.request(async () => createWorkbenchGraphModel(font, [], [])), /disposed/);
});

test('a burst admits only one active and the latest pending factory, never publishing stale geometry', async () => {
	const engine = new ControlledEngine();
	const session = new AsyncGraphLayout<Model>(() => engine);
	request(session, 0);
	const settling = session.settled;
	for (let generation = 1; generation <= 1000; generation += 1) request(session, generation);
	assert.equal(session.settled, settling, 'the burst does not create a promise chain per queued request');
	assert.deepEqual(engine.calls, ['0']);
	assert.deepEqual(session.state, { kind: 'pending' });
	engine.complete(0);
	await Promise.resolve(); await Promise.resolve();
	assert.deepEqual(engine.calls, ['0', '1000']);
	assert.deepEqual(session.state, { kind: 'pending' }, 'generation zero has no publication rights');
	engine.complete(1000);
	await settling;
	const ready = session.state;
	if (ready.kind !== 'ready') throw new Error('expected current graph');
	assert.equal(ready.model.generation, 1000);
	const published = ready.model;
	request(session, 1001);
	assert.deepEqual(session.state, { kind: 'pending' }, 'a published old graph is not presented as the new generation');
	assert.equal(published.generation, 1000, 'publication does not lend old geometry to the next request');
	engine.complete(1001);
	await session.settled;
	session.dispose();
	assert.equal(engine.disposals, 1);
});

test('hidden-source invalidation removes waiting work and publication without destroying the reusable engine', async () => {
	const engine = new ControlledEngine();
	const session = new AsyncGraphLayout<Model>(() => engine);
	request(session, 0);
	request(session, 1);
	session.invalidate();
	engine.complete(0);
	await session.settled;
	assert.deepEqual(engine.calls, ['0']);
	assert.deepEqual(session.state, { kind: 'idle' });
	assert.equal(engine.disposals, 0);
	request(session, 2);
	engine.complete(2);
	await session.settled;
	const ready = session.state;
	assert.equal(ready.kind, 'ready');
	session.invalidate();
	assert.deepEqual(session.state, { kind: 'idle' });
	session.dispose();
});

test('current failure is explicit; cancelled failures do not replace current source state', async () => {
	const engine = new ControlledEngine();
	const session = new AsyncGraphLayout<Model>(() => engine);
	const oldError = new Error('obsolete generation');
	const currentError = new Error('layout rejected');
	request(session, 0); request(session, 1);
	engine.fail(0, oldError);
	await Promise.resolve(); await Promise.resolve();
	assert.equal(session.state.kind, 'pending');
	engine.fail(1, currentError);
	await session.settled;
	assert.deepEqual(session.state, { kind: 'failed', error: currentError });
	session.request(() => { throw oldError; });
	await session.settled;
	assert.deepEqual(session.state, { kind: 'failed', error: oldError });
	session.dispose();
});

test('engine construction failure is a failed generation rather than unhandled rejection or empty success', async () => {
	const error = new Error('engine construction failed');
	const session = new AsyncGraphLayout<Model>(() => { throw error; });
	request(session, 0);
	await session.settled;
	assert.deepEqual(session.state, { kind: 'failed', error });
	session.dispose();
});

test('closing an input ends its work and subscription, not the canonical working copy or undo history', async () => {
	const models = new EditorTextModelService();
	const resource = { domain: 0, path: 'layout.lua', source: { resid: 'layout', type: 'lua' } } as const;
	const model = models.retain(resource, 'lua', 'original');
	const engine = new ControlledEngine();
	const input = new GraphLayoutTestInput<Model>(model, () => engine);
	const group = new EditorTabGroupModel();
	group.initialize(input);
	request(input.layout, 0); request(input.layout, 1);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(input.layout.state.kind, 'idle', 'the canonical change event revokes pending publication immediately');
	request(input.layout, 2);
	group.removeAt(0);
	assert.equal(input.layout.state.kind, 'disposed');
	assert.equal(engine.disposals, 1);
	await input.layout.settled;
	assert.deepEqual(engine.calls, ['0'], 'neither queued projection ran after close');
	assert.equal(models.get(resource), model);
	model.undo();
	assert.equal(model.buffer.getText(), 'original', 'close does not dispose the shared model');
	assert.equal(input.layout.state.kind, 'disposed', 'the closed input no longer receives model changes');
	const reopened = new GraphLayoutTestInput<Model>(model, () => new ControlledEngine());
	group.initialize(reopened);
	assert.notEqual(reopened, input);
	assert.equal(reopened.workingCopy, input.workingCopy);
	group.clear(); models.clear();
});

test('tab changes preserve input work; group reset disposes all retained inputs exactly once', async () => {
	const engines = [new ControlledEngine(), new ControlledEngine()];
	const inputs = engines.map((engine, index) => new GraphLayoutTestInput<Model>(new EditorTextModel({
		domain: 0, path: `${index}.lua`, source: { resid: `${index}`, type: 'lua' },
	}, 'lua', ''), () => engine));
	const group = new EditorTabGroupModel();
	group.initialize(inputs[0]); group.add(inputs[1]);
	request(inputs[0].layout, 0); request(inputs[1].layout, 1);
	group.activate(inputs[1]); group.move(0, 1);
	assert.equal(inputs[0].layout.state.kind, 'pending');
	assert.deepEqual(engines.map(engine => engine.disposals), [0, 0]);
	group.clear(); group.clear();
	await Promise.all(inputs.map(input => input.layout.settled));
	assert.deepEqual(engines.map(engine => engine.disposals), [1, 1]);
	assert.deepEqual(inputs.map(input => input.layout.state.kind), ['disposed', 'disposed']);
	for (const input of inputs) input.workingCopy.dispose();
});

test('a disposable store ends its owned resources once and rejects attaching resources after close', () => {
	const owner = new DisposableStore();
	let disposed = 0;
	const item = { dispose: () => { disposed += 1; } };
	assert.equal(owner.add(item), item);
	owner.add(item);
	owner.dispose(); owner.dispose();
	assert.equal(disposed, 1);
	assert.equal(owner.isDisposed, true);
	assert.throws(() => owner.add(item), /disposed owner/);
});
