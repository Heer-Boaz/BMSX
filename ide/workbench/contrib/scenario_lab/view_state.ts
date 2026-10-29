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
	ScenarioLabResultPaneState,
	ScenarioLabResultRow,
	ScenarioLabTestPaneState,
	ScenarioLabTestRow,
	ScenarioLabViewState,
} from './view_model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchMenu } from '../../ui/menu/model';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { SCENARIO_LAB_TITLE_ACTIONS } from './menus';
import type { TestDebugger } from '../../../testing/debugger';

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

class ScenarioLabView implements ScenarioLabViewState {
	public debugger: TestDebugger | undefined;
	public actionsDirty = true;
	public readonly testPane: ScenarioLabTestPaneState = {
		...createScenarioLabPaneState<ScenarioLabTestRow>(),
		collapsedNodeIds: new Set(),
		selectedNodeId: null,
		rowsDirty: true,
		projectedRevision: -1,
	};
	public readonly resultPane: ScenarioLabResultPaneState = {
		...createScenarioLabPaneState<ScenarioLabResultRow>(),
		expandedResultIds: new Set(),
		projectedRevision: -1,
		projectedNodeId: null,
		newestRunId: null,
	};
	public focus: ScenarioLabViewState['focus'] = 'tests';
	public pendingReveal = false;
	public readonly split = new WorkbenchSplitView(5 / 12);
	public splitRevision = -1;
	public readonly layout = createScenarioLabLayout();
	public readonly actionBar = createWorkbenchActionBar(new WorkbenchMenu(SCENARIO_LAB_TITLE_ACTIONS, this), true, WORKBENCH_MENUS['scenarioLab.context']);
	public readonly status = {
		info: '',
	};
	public lastPointerClickTimeMs = 0;
	public lastPointerClickRowId: string | null = null;

	public constructor(public readonly collection: ScenarioTestCollection, public readonly resultService: ScenarioResultService,
		public runActive: boolean) {}
}

/** Creates one retained Scenario Lab editor input with its projection invariants installed. */
export function createScenarioLabViewState(
	collection: ScenarioTestCollection,
	results: ScenarioResultService,
	runActive: boolean,
): ScenarioLabViewState {
	const view = new ScenarioLabView(collection, results, runActive);
	rebuildScenarioLabTestRows(view);
	refreshScenarioLabProjection(view);
	updateScenarioLabStatus(view);
	return view;
}
