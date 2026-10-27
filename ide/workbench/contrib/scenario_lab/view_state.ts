import { WorkbenchSplitView } from '../../ui/split_view';
import {
	createScenarioLabLayout,
	createScenarioLabPaneLayout,
} from './layout';
import { updateScenarioLabStatus } from './navigation';
import {
	rebuildScenarioLabTestRows,
	refreshScenarioLabProjection,
} from './projection';
import type { ScenarioResultService } from '../../../testing/scenario/result_service';
import type { ScenarioTestCollection } from '../../../testing/scenario/test_collection';
import type {
	ScenarioLabPaneState,
	ScenarioLabResultRow,
	ScenarioLabTestRow,
	ScenarioLabViewState,
} from './view_model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';

function createScenarioLabPaneState<Row>(): ScenarioLabPaneState<Row> {
	return {
		rows: [],
		selectionIndex: -1,
		scroll: 0,
		hoverIndex: -1,
		layout: createScenarioLabPaneLayout(),
		textDirty: true,
	};
}

/** Creates one retained Scenario Lab editor input with its projection invariants installed. */
export function createScenarioLabViewState(
	collection: ScenarioTestCollection,
	results: ScenarioResultService,
	runActive: boolean,
): ScenarioLabViewState {
	const view: ScenarioLabViewState = {
		debugger: undefined,
		actionsDirty: true,
		collection,
		resultService: results,
		testPane: {
			...createScenarioLabPaneState<ScenarioLabTestRow>(),
			collapsedNodeIds: new Set(),
			selectedNodeId: null,
			rowsDirty: true,
			projectedRevision: -1,
		},
		resultPane: {
			...createScenarioLabPaneState<ScenarioLabResultRow>(),
			expandedResultIds: new Set(),
			projectedRevision: -1,
			projectedNodeId: null,
			newestRunId: null,
		},
		focus: 'tests',
		runActive,
		pendingReveal: false,
		split: new WorkbenchSplitView(5 / 12),
		splitRevision: -1,
		layout: createScenarioLabLayout(),
		actionBar: createWorkbenchActionBar('scenarioLab.title', true, WORKBENCH_MENUS['scenarioLab.context']),
		status: {
			info: '',
			renderedInfo: '',
			dirty: true,
		},
		lastPointerClickTimeMs: 0,
		lastPointerClickRowId: null,
	};
	rebuildScenarioLabTestRows(view);
	refreshScenarioLabProjection(view);
	updateScenarioLabStatus(view);
	return view;
}
