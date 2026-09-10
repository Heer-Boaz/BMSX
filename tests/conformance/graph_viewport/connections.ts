import { WorkbenchGraphPointerResult } from '../../../ide/workbench/ui/graph/control';
import type { createFixture } from './browser';

function check(condition: boolean, message: string): void {
	if (!condition) throw new Error(message);
}

/** Real pane/input/render protocol, not a fake FSM retarget command or Lua editor. */
export function exerciseGraphConnections(fixture: Awaited<ReturnType<typeof createFixture>>) {
	const { panes, pane, inputs, move, button, step, key, connection: f } = fixture;
	const input = inputs[2];
	panes.openEditor(input);
	const position = (x: number, y: number) => move(x + f.view.bounds.left - f.view.scrollX, y + f.view.bounds.top - f.view.scrollY);
	const press = (end: 'source' | 'target') => {
		const i = end === 'source' ? 0 : f.edge.points.length - 2;
		position(f.edge.points[i], f.edge.points[i + 1]); step(); button(true); step();
	};
	const cancel = () => { key('Escape', true); step(); key('Escape', false); step(); button(false); step(); };
	const select = () => { f.view.selection = f.edge; step(); };
	const geometry = JSON.stringify(f.model);
	select();
	for (let click = 0; click < 3; click += 1) {
		press('target');
		check(f.view.selection === f.edge && pane.result === WorkbenchGraphPointerResult.Handled, 'endpoint click does not activate Source or select the node underneath');
		button(false); step();
	}
	check(f.interaction.starts.length === 0, 'clicks do not begin a contribution session');
	press('target'); position(248, 146); step();
	check(f.interaction.feedback!.target === f.target && f.interaction.drops.length === 0, 'physical threshold admits and draws a target without dropping');
	const preview = pane.graph.dragFeedback;
	const overs = f.interaction.overs;
	for (let frame = 0; frame < 30; frame += 1) step();
	check(f.interaction.overs === overs && pane.graph.dragFeedback === preview, 'stationary input/render retains preview without repeating target work');
	cancel();
	check(pane.graph.dragFeedback === undefined && f.interaction.drops.length === 0, 'focus-routed Escape cancels without a drop');
	for (const active of [false, true]) {
		press('target');
		if (active) { position(248, 146); step(); }
		f.interaction.ends = undefined; step();
		check(pane.graph.dragFeedback === undefined && pane.graph.connectionHandles === undefined, 'revoked capability ends pending/active capture without motion');
		f.interaction.ends = 'both'; step(); position(248, 146); step(); button(false); step();
		check(f.interaction.drops.length === 0, 'restoring capability while held cannot revive a press');
	}
	press('target'); position(248, 146); step();
	panes.openEditor(inputs[1]); step(); panes.openEditor(input); step(); button(false); step();
	check(pane.graph.dragFeedback === undefined && f.interaction.drops.length === 0, 'real editor-input switch cancels and retains only view state');
	select(); press('source'); position(248, 146); step(); button(false); step();
	check(f.interaction.drops.length === 1 && f.interaction.drops[0].start.end === 'source'
		&& f.interaction.drops[0].target === f.target, 'physical source-end drop reaches the contribution exactly once');
	select(); press('target'); position(248, 146); step(); position(380, 150); button(false); step();
	check(f.interaction.drops.length === 1, 'actual outside-graph release cannot commit the last valid hover');
	check(JSON.stringify(f.model) === geometry && !input.workingCopy.dirty && !input.workingCopy.canUndo,
		'generic interaction changes neither layout topology nor the fixture carrier document');

	return {
		info: { nodes: f.model.nodes.length, edges: f.model.edges.length, drops: f.interaction.drops.length,
			boundary: 'shared pointer/pane/preview only, not FSM source authoring' },
		present(state: 'handles' | 'accepted' | 'free') {
			cancel(); f.view.scrollX = f.view.scrollY = 0; select();
			if (state !== 'handles') {
				press('target');
				position(state === 'accepted' ? 248 : 146, state === 'accepted' ? 146 : 100); step();
				check(f.interaction.feedback!.accepted === (state === 'accepted'), 'capture reflects the actual admitted/free pointer');
			}
			return { bounds: f.view.bounds, headers: f.model.nodes.map(node => ({ left: node.bounds.left + f.view.bounds.left,
				right: node.bounds.right + f.view.bounds.left, top: node.bounds.top + f.view.bounds.top,
				bottom: node.bounds.top + node.headerHeight + f.view.bounds.top })) };
		},
		finish() { cancel(); panes.openEditor(inputs[0]); step(); },
	};
}
