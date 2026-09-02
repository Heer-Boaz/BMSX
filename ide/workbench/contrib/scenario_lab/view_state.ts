import {
	createScenarioLabLayout,
	createScenarioLabPaneLayout,
	prepareScenarioLabLayout,
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
		collection,
		resultService: results,
		testPane: {
			...createScenarioLabPaneState<ScenarioLabTestRow>(),
			collapsedRootIds: new Set(),
			selectedTestId: null,
			rowsDirty: true,
		},
		resultPane: {
			...createScenarioLabPaneState<ScenarioLabResultRow>(),
			expandedResultIds: new Set(),
			projectedRevision: -1,
			projectedTestId: null,
			newestResultId: null,
			selectedTestHasResult: false,
		},
		focus: 'tests',
		runActive,
		layout: createScenarioLabLayout(),
		actionBar: createWorkbenchActionBar('scenarioLab.title'),
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
	prepareScenarioLabLayout(view);
	return view;
}
