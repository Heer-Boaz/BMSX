import { BrowserGraphLayoutEngine } from '../../../ide/browser/graph_layout';
import { inputFocus } from '../../../ide/input/focus';
import { layoutWorkbenchCompoundGraph } from '../../../ide/workbench/ui/graph/compound_layout';
import { compoundGraphFixture } from '../../helpers/compound_graph_fixture';
import type { createFixture } from './browser';

function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Real input/model/group owners and the packaged Worker, independent of current carts. */
export async function exerciseGraphLayoutLifetime(fixture: Awaited<ReturnType<typeof createFixture>>) {
	const { inputs, group, panes, font, view, otherView, step, move, button } = fixture;
	const [first, second] = inputs;
	const admitted: number[] = [];
	const request = (generation: number) => first.layout.request(async engine => {
		admitted.push(generation);
		const graph = compoundGraphFixture(font);
		return layoutWorkbenchCompoundGraph(font, graph.roots, graph.links, engine);
	});
	let frames = 0;
	let frameRequest: number;
	const animate = () => { step(); frames += 1; frameRequest = requestAnimationFrame(animate); };
	frameRequest = requestAnimationFrame(animate);
	try {
		request(0);
		for (let generation = 1; generation <= 1000; generation += 1) {
			first.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'x' }]);
			request(generation);
		}
		check(admitted.length === 1 && first.layout.state.kind === 'pending', 'edits coalesce before projection/measurement/Worker messaging');
		group.activate(second); panes.openEditor(second);
		const focus = inputFocus.target;
		const inactiveView = view.model;
		await first.layout.settled;
		check(admitted.length === 2 && admitted[1] === 1000, 'only first and last geometry generations execute');
		check(first.layout.state.kind === 'ready', 'the current input receives its result while hidden');
		check(panes.activePane.input === second && inputFocus.target === focus && view.model === inactiveView,
			'async result neither activates a pane nor writes an inactive control');
		first.workingCopy.undo();
		check(first.layout.state.kind === 'idle', 'hidden canonical Undo immediately invalidates the result');
		request(1001);
		first.workingCopy.redo();
		check(first.layout.state.kind === 'idle', 'hidden Redo invalidates a running generation');
		await first.layout.settled;
		check(first.layout.state.kind === 'idle', 'hidden running result cannot resurrect outdated source');
		request(1002);
		await first.layout.settled;
		const ready = first.layout.state;
		if (ready.kind !== 'ready') throw new Error('expected current compound geometry');
		group.activate(first); panes.openEditor(first);
		view.setModel(ready.model, null);
		view.scrollX = view.scrollBounds.left + 30;
		view.scrollY = view.scrollBounds.top + 30;
		const panX = view.scrollX;
		const panY = view.scrollY;
		// Begin a physical capture, then detach the pane before closing its input.
		move(150, 110); step(); button(true); step(); move(160, 115); step();
		check(view.scrollX === panX - 10 && view.scrollY === panY - 5, 'close must exercise a live physical pan capture');
		request(1003); request(1004);
		group.activate(second); panes.openEditor(second);
		group.removeAt(group.indexOf(first));
		const otherX = otherView.scrollX;
		const otherY = otherView.scrollY;
		move(170, 120); step();
		check(otherView.scrollX === otherX && otherView.scrollY === otherY && first.layout.state.kind === 'disposed',
			'close ends control capture and input-owned work without transferring a held gesture');
		const closedFocus = inputFocus.target;
		await first.layout.settled;
		check(!admitted.includes(1004), 'close removes queued geometry before measurement or postMessage');
		first.workingCopy.undo();
		check(first.layout.state.kind === 'disposed' && inputFocus.target === closedFocus, 'closed input has no model listener or completion focus');
		button(false); step();
		check(frames > 0, 'the actual input/render loop remains responsive during native-worker computation');
		return { submitted: 1005, admitted, framesDuringLayout: frames };
	} finally {
		cancelAnimationFrame(frameRequest);
		panes.dispose(); group.clear();
		for (const input of inputs) input.workingCopy.dispose();
	}
}

export async function exerciseGraphWorkerFailures() {
	const engine = new BrowserGraphLayoutEngine(new Worker('/graph-layout.worker.js'));
	try {
		// Client-side send failure does not leave a resolver waiting for a nonexistent reply.
		const uncloneable = { id: 'not-transferable', callback: () => {} };
		const cloneFailure = await Promise.allSettled([engine.layout(uncloneable)]);
		check(cloneFailure[0].status === 'rejected', 'structured-clone failure must reject');
		const results = await Promise.allSettled([
			engine.layout({ id: 'bad-topology', children: [], edges: [{ id: 'missing', sources: ['none'], targets: ['none'] }],
				layoutOptions: { 'elk.algorithm': 'layered' } }),
			engine.layout({ id: 'valid', children: [], edges: [], layoutOptions: { 'elk.algorithm': 'layered' } }),
		]);
		check(results[0].status === 'rejected' && results[1].status === 'fulfilled', 'ELK request failure and independent success have distinct replies');
		const pending = [engine.layout({ id: 'closing-1' }), engine.layout({ id: 'closing-2' })];
		engine.dispose(); engine.dispose();
		const closed = await Promise.allSettled([...pending, engine.layout({ id: 'after-close' })]);
		check(closed.every(result => result.status === 'rejected'), 'terminate settles all pending and subsequent requests');
	} finally { engine.dispose(); }
	for (const url of ['/worker-crash.js', '/worker-missing.js']) {
		const broken = new BrowserGraphLayoutEngine(new Worker(url));
		try {
			const results = await Promise.allSettled([broken.layout({ id: 'first' }), broken.layout({ id: 'second' })]);
			check(results.every(result => result.status === 'rejected'), `${url}: worker load/execution failure settles every request`);
			const first = results[0];
			const second = results[1];
			if (first.status !== 'rejected' || second.status !== 'rejected') throw new Error('expected worker failure');
			check(first.reason === second.reason && first.reason instanceof Error, 'all pending callers receive the same terminal failure');
			const subsequent = await Promise.allSettled([broken.layout({ id: 'later' })]);
			check(subsequent[0].status === 'rejected' && subsequent[0].reason === first.reason, 'no implicit worker restart or fallback');
		} finally { broken.dispose(); }
	}
	return { cloneFailure: true, elkFailure: true, close: true, crash: true, missingAsset: true };
}
