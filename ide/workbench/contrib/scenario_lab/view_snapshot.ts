import type { ScenarioTestRootId } from '../../../testing/scenario/test_collection';
import { rebuildScenarioLabTestRows, updateSelectedScenarioNode } from './projection';
import type { ScenarioLabViewState } from './view_model';

/** Test-side context survives a workspace restart; run results and tasks do not. */
export type ScenarioLabTestViewSnapshot = {
	readonly testId: ScenarioLabViewState['testPane']['selectedNodeId'];
	readonly scroll: number;
	readonly collapsedRoots: readonly ScenarioTestRootId[];
};

export function captureScenarioLabTestView(view: ScenarioLabViewState): ScenarioLabTestViewSnapshot {
	return { testId: view.testPane.selectedNodeId, scroll: view.testPane.scroll, collapsedRoots: [...view.testPane.collapsedRootIds] };
}

export function restoreScenarioLabTestView(view: ScenarioLabViewState, snapshot: ScenarioLabTestViewSnapshot): void {
	view.testPane.collapsedRootIds.clear();
	for (const id of snapshot.collapsedRoots) view.testPane.collapsedRootIds.add(id);
	rebuildScenarioLabTestRows(view);
	view.testPane.selectionIndex = view.testPane.rows.findIndex(row => row.id === snapshot.testId);
	updateSelectedScenarioNode(view);
	view.testPane.scroll = snapshot.scroll;
}
