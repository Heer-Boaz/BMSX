import { BrowserGraphLayoutEngine } from '../../../ide/browser/graph_layout';
import { createWorkbenchGraphModel } from '../../../ide/workbench/ui/graph/model';
import { layoutWorkbenchCompoundGraph } from '../../../ide/workbench/ui/graph/compound_layout';
import { compoundGraphFixture } from '../../helpers/compound_graph_fixture';
import type { createFixture } from './browser';

function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Real worker and shared physical graph controls, without a cart or FSM UI mock. */
export async function exerciseCompoundGraph(fixture: Awaited<ReturnType<typeof createFixture>>) {
	const engine = new BrowserGraphLayoutEngine(new Worker('/graph-layout.worker.js'));
	const graph = compoundGraphFixture(fixture.font);
	let frames = 0;
	let frameRequest: number;
	const animate = () => { fixture.step(); frames += 1; frameRequest = requestAnimationFrame(animate); };
	frameRequest = requestAnimationFrame(animate);
	try {
		const start = performance.now();
		const model = await layoutWorkbenchCompoundGraph(fixture.font, graph.roots, graph.links, engine);
		const layoutMilliseconds = performance.now() - start;
		cancelAnimationFrame(frameRequest);
		check(frames > 0, 'the actual renderer/input loop advances while the worker lays out');
		check(model.nodes[0] === graph.roots[0] && model.nodes[0].action() === 'MACHINE', 'domain identity never crosses the Worker protocol');
		const { view, move, button, step } = fixture;
		view.setModel(model, null);
		for (const edge of model.edges) {
			if (edge.labels.length === 0) continue;
			const label = edge.labels[0].bounds;
			view.scrollX = label.left - 100;
			view.scrollY = label.top - 100;
			move(view.bounds.left + 101, view.bounds.top + 101); step(); button(true); step();
			check(view.selection === edge, `physical label hit must select ${edge.link.proof}, even with duplicate text`);
			button(false); step();
		}
		const root = graph.roots[0];
		view.scrollX = root.bounds.left - 10;
		view.scrollY = root.bounds.top - 10;
		const x = view.bounds.left + 12;
		const y = view.bounds.top + root.headerHeight + 16;
		move(x, y); step(); button(true); step(); move(x + 7, y + 9); step();
		check(view.selection === null && view.scrollX === root.bounds.left - 17 && view.scrollY === root.bounds.top - 19,
			'blank container interior pans through the real control, not its parent node');
		button(false); step();
		view.scrollX = root.bounds.left - 10;
		view.scrollY = root.bounds.top - 10;
		move(view.bounds.left + 12, view.bounds.top + 12); step(); button(true); step(); button(false); step();
		check(view.selection === root, 'the container title is a physical node target');
		const geometry = JSON.stringify(model);
		for (let index = 0; index < 30; index += 1) step();
		check(view.model === model && JSON.stringify(model) === geometry, 'warm input/render frames retain the layout');
		function present(scope: 'ROOM' | 'LANES'): void {
			view.setModel(model, null);
			const node = graph.nodes.get(scope)!;
			view.scrollX = node.bounds.left - 6;
			view.scrollY = node.bounds.top - 6;
			move(-1, -1); step();
		}
		return {
			present,
			info: { nodes: model.nodes.length, edges: model.edges.length, layoutMilliseconds, framesDuringLayout: frames },
			/** Same published geometry, with/without one edge, for raster-occlusion oracles. */
			renderEdge(index: number, visible: boolean) {
				const edge = model.edges[index];
				view.setModel(createWorkbenchGraphModel(model.font, model.nodes, visible ? [edge] : []), null);
				view.scrollX = edge.bounds.left - 12;
				view.scrollY = edge.bounds.top - 12;
				move(-1, -1); step();
				const offsetX = view.bounds.left - view.scrollX;
				const offsetY = view.bounds.top - view.scrollY;
				const headers = model.nodes.map(node => ({ left: node.bounds.left + offsetX, right: node.bounds.right + offsetX,
					top: node.bounds.top + offsetY, bottom: node.bounds.top + node.headerHeight + offsetY }));
				const labels = edge.labels.map(label => ({ left: label.bounds.left + offsetX, right: label.bounds.right + offsetX,
					top: label.bounds.top + offsetY, bottom: label.bounds.bottom + offsetY }));
				const probes: { x: number; y: number }[] = [];
				const covered = [...headers, ...labels];
				for (let i = 0; i + 3 < edge.points.length; i += 2) {
					const x = Math.round((edge.points[i] + edge.points[i + 2]) / 2 + offsetX);
					const y = Math.round((edge.points[i + 1] + edge.points[i + 3]) / 2 + offsetY);
					if (x < view.bounds.left + 2 || x >= view.bounds.right - 2 || y < view.bounds.top + 2 || y >= view.bounds.bottom - 2) continue;
					if (covered.some(area => x >= area.left - 2 && x < area.right + 2 && y >= area.top - 2 && y < area.bottom + 2)) continue;
					probes.push({ x, y });
				}
				return { proof: edge.link.proof, headers, probes, bounds: view.bounds };
			},
		};
	} finally {
		cancelAnimationFrame(frameRequest);
		engine.dispose();
	}
}
