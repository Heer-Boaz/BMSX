import type { EditorFont } from '../../../editor/ui/view/font';
import type { WorkbenchActionBarState } from '../../ui/action_bar';
import type {
	WorkbenchListLayout,
	WorkbenchListState,
} from '../../ui/list_view';
import type {
	ScenarioResultService,
	ScenarioActionEffectTriggerRecord,
	ScenarioActionEffectTriggerTrace,
	ScenarioResultCapture,
	ScenarioFsmTransitionRecord,
	ScenarioFsmTransitionTrace,
	ScenarioResultLog,
	ScenarioRunFailure,
	ScenarioRunResult,
	ScenarioRunState,
	ScenarioSourceLocation,
} from '../../../testing/scenario/result_service';
import type {
	ScenarioTestCollection,
	ScenarioTestId,
	ScenarioTestItem,
	ScenarioTestRoot,
	ScenarioTestRootId,
} from '../../../testing/scenario/test_collection';

export type ScenarioLabFocus = 'tests' | 'results';
export type ScenarioLabTestRowId = ScenarioTestRootId | ScenarioTestId;

type ScenarioLabTestRowBase = {
	readonly id: ScenarioLabTestRowId;
	readonly root: ScenarioTestRoot;
	readonly depth: number;
	latestState: ScenarioRunState | null;
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
	readonly result: ScenarioRunResult;
	text: string;
	twistieLeft: number;
	twistieRight: number;
};

export type ScenarioLabResultRow = ScenarioLabResultRowBase & ({
	readonly kind: 'result';
	readonly location: ScenarioSourceLocation;
	readonly expandable: true;
	expanded: boolean;
} | {
	readonly kind: 'failure';
	readonly location: ScenarioSourceLocation;
	readonly failure: ScenarioRunFailure;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'log';
	readonly location: ScenarioSourceLocation;
	readonly log: ScenarioResultLog;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'capture';
	readonly location: ScenarioSourceLocation;
	readonly capture: ScenarioResultCapture;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'fsm_transition';
	readonly trace: ScenarioFsmTransitionTrace;
	readonly transition: ScenarioFsmTransitionRecord;
	readonly expandable: false;
	readonly expanded: false;
} | {
	readonly kind: 'actioneffect_trigger';
	readonly trace: ScenarioActionEffectTriggerTrace;
	readonly trigger: ScenarioActionEffectTriggerRecord;
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
	selectedTestId: ScenarioTestId | null;
	rowsDirty: boolean;
};

export type ScenarioLabResultPaneState = ScenarioLabPaneState<ScenarioLabResultRow> & {
	readonly expandedResultIds: Set<string>;
	projectedRevision: number;
	projectedTestId: ScenarioTestId | null;
	newestResultId: string | null;
	selectedTestHasResult: boolean;
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
