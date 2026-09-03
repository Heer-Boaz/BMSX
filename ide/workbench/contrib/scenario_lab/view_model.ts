import type { EditorFont } from '../../../editor/ui/view/font';
import type { WorkbenchActionBarState } from '../../ui/action_bar';
import type {
	WorkbenchListLayout,
	WorkbenchListState,
} from '../../ui/list_view';
import type {
	ScenarioResultService,
	ScenarioActionEffectFact,
	ScenarioActionEffectTrace,
	ScenarioResultCapture,
	ScenarioFsmTransitionRecord,
	ScenarioFsmTransitionTrace,
	ScenarioResultLog,
	ScenarioRun,
	ScenarioRunFailure,
	ScenarioTestResult,
	ScenarioResultState,
	ScenarioSourceLocation,
} from '../../../testing/scenario/result_service';
import type {
	ScenarioTestCollection,
	ScenarioTestId,
	ScenarioTestItem,
	ScenarioTestNodeId,
	ScenarioTestRoot,
	ScenarioTestRootId,
} from '../../../testing/scenario/test_collection';

export type ScenarioLabFocus = 'tests' | 'results';
export type ScenarioLabTestRowId = ScenarioTestRootId | ScenarioTestId;

type ScenarioLabTestRowBase = {
	readonly id: ScenarioLabTestRowId;
	readonly root: ScenarioTestRoot;
	readonly depth: number;
	latestState: ScenarioResultState | null;
	text: string;
	twistieLeft: number;
	twistieRight: number;
};

export type ScenarioLabTestRow = ScenarioLabTestRowBase & ({
	readonly kind: 'root';
	readonly test: null;
	readonly expandable: true;
	expanded: boolean;
} | {
	readonly kind: 'test';
	readonly test: ScenarioTestItem;
	readonly expandable: false;
	readonly expanded: false;
});

type ScenarioLabResultRowBase = {
	readonly id: string;
	text: string;
	twistieLeft: number;
	twistieRight: number;
};

export type ScenarioLabResultRow = ScenarioLabResultRowBase & ({
	readonly kind: 'run';
	readonly run: ScenarioRun;
	readonly result: null;
	readonly expandable: true;
	expanded: boolean;
} | {
	readonly kind: 'result';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly location: ScenarioSourceLocation;
	readonly expandable: true;
	expanded: boolean;
} | {
	readonly kind: 'failure';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly location: ScenarioSourceLocation;
	readonly failure: ScenarioRunFailure;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'log';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly location: ScenarioSourceLocation;
	readonly log: ScenarioResultLog;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'capture';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly location: ScenarioSourceLocation;
	readonly capture: ScenarioResultCapture;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'fsm_transition';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly trace: ScenarioFsmTransitionTrace;
	readonly transition: ScenarioFsmTransitionRecord;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'actioneffect_fact';
	readonly run: ScenarioRun;
	readonly result: ScenarioTestResult;
	readonly trace: ScenarioActionEffectTrace;
	readonly fact: ScenarioActionEffectFact;
	readonly expandable: false;
	readonly expanded: false;
});

export type ScenarioLabPaneLayout = WorkbenchListLayout & {
	headerTop: number;
	headerBottom: number;
};

export type ScenarioLabPaneState<Row> = WorkbenchListState<Row, ScenarioLabPaneLayout> & {
	textDirty: boolean;
};

export type ScenarioLabTestPaneState = ScenarioLabPaneState<ScenarioLabTestRow> & {
	readonly collapsedRootIds: Set<ScenarioTestRootId>;
	selectedNodeId: ScenarioTestNodeId | null;
	rowsDirty: boolean;
};

export type ScenarioLabResultPaneState = ScenarioLabPaneState<ScenarioLabResultRow> & {
	readonly expandedResultIds: Set<string>;
	projectedRevision: number;
	projectedNodeId: ScenarioTestNodeId | null;
	newestRunId: string | null;
};

export type ScenarioLabLayout = {
	left: number;
	top: number;
	right: number;
	bottom: number;
	toolbarBottom: number;
	rowHeight: number;
	font: EditorFont | null;
	viewportWidth: number;
	viewportHeight: number;
	codeAreaTop: number;
	codeAreaBottom: number;
};

export type ScenarioLabStatus = {
	info: string;
	renderedInfo: string;
	dirty: boolean;
};

/** Retained projection and interaction state for the one Scenario Lab editor input. */
export type ScenarioLabViewState = {
	readonly collection: ScenarioTestCollection;
	readonly resultService: ScenarioResultService;
	readonly testPane: ScenarioLabTestPaneState;
	readonly resultPane: ScenarioLabResultPaneState;
	focus: ScenarioLabFocus;
	runActive: boolean;
	readonly layout: ScenarioLabLayout;
	readonly actionBar: WorkbenchActionBarState;
	readonly status: ScenarioLabStatus;
	lastPointerClickTimeMs: number;
	lastPointerClickRowId: string | null;
};
