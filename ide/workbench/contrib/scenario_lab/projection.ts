import type {
	ScenarioRunResult,
	ScenarioSourceLocation,
} from '../../../testing/scenario/result_service';
import type {
	ScenarioTestId,
	ScenarioTestItem,
} from '../../../testing/scenario/test_collection';
import type {
	ScenarioLabResultPaneState,
	ScenarioLabResultRow,
	ScenarioLabTestPaneState,
	ScenarioLabTestRow,
	ScenarioLabViewState,
} from './view_model';

type ScenarioLabIdentifiedRow = ScenarioLabTestRow | ScenarioLabResultRow;

function latestResultForTest(
	state: ScenarioLabViewState,
	testId: ScenarioTestId,
): ScenarioRunResult | null {
	const results = state.resultService.results;
	for (let index = 0; index < results.length; index += 1) {
		if (results[index].test.id === testId) {
			return results[index];
		}
	}
	return null;
}

export function rebuildScenarioLabTestRows(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	const selectedId = pane.selectionIndex >= 0
		? pane.rows[pane.selectionIndex].id
		: pane.selectedTestId;
	pane.rows.length = 0;
	const roots = state.collection.roots;
	for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
		const root = roots[rootIndex];
		const expanded = !pane.collapsedRootIds.has(root.id);
		pane.rows.push({
			id: root.id,
			kind: 'root',
			root,
			test: null,
			depth: 0,
			expandable: true,
			expanded,
			latestState: null,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
		if (!expanded) {
			continue;
		}
		const tests = state.collection.resolveRoot(root.id);
		for (let testIndex = 0; testIndex < tests.length; testIndex += 1) {
			const test = tests[testIndex];
			pane.rows.push({
				id: test.id,
				kind: 'test',
				root,
				test,
				depth: 1,
				expandable: false,
				expanded: false,
				latestState: null,
				text: '',
				twistieLeft: 0,
				twistieRight: 0,
			});
		}
	}

	pane.selectionIndex = findScenarioLabRowIndex(pane.rows, selectedId);
	if (pane.selectionIndex < 0) {
		pane.selectionIndex = firstScenarioTestRowIndex(pane);
	}
	updateSelectedScenarioTest(state);
	pane.hoverIndex = -1;
	pane.rowsDirty = false;
	pane.textDirty = true;
}

function firstScenarioTestRowIndex(pane: ScenarioLabTestPaneState): number {
	for (let index = 0; index < pane.rows.length; index += 1) {
		if (pane.rows[index].kind === 'test') {
			return index;
		}
	}
	return pane.rows.length > 0 ? 0 : -1;
}

function findScenarioLabRowIndex(
	rows: readonly ScenarioLabIdentifiedRow[],
	rowId: string | null,
): number {
	if (rowId === null) {
		return -1;
	}
	for (let index = 0; index < rows.length; index += 1) {
		if (rows[index].id === rowId) {
			return index;
		}
	}
	return -1;
}

export function updateSelectedScenarioTest(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	let nextId: ScenarioTestId | null = null;
	if (pane.selectionIndex >= 0) {
		const row = pane.rows[pane.selectionIndex];
		if (row.kind === 'test') {
			nextId = row.test.id;
		}
	}
	if (pane.selectedTestId !== nextId) {
		pane.selectedTestId = nextId;
		state.resultPane.projectedTestId = null;
	}
}

function appendScenarioResultRows(
	pane: ScenarioLabResultPaneState,
	result: ScenarioRunResult,
): void {
	const expanded = pane.expandedResultIds.has(result.id);
	const sourceLocation: ScenarioSourceLocation = {
		resource: result.test.resource,
		line: 1,
		column: 1,
	};
	pane.rows.push({
		id: result.id,
		kind: 'result',
		result,
		location: sourceLocation,
		expandable: true,
		expanded,
		text: '',
		twistieLeft: 0,
		twistieRight: 0,
	});
	if (!expanded) {
		return;
	}
	const failure = result.failure;
	if (failure !== null) {
		pane.rows.push({
			id: `${result.id}:failure`,
			kind: 'failure',
			result,
			failure,
			location: failure.location,
			expandable: false,
			expanded: false,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
	}
	for (let index = 0; index < result.logs.length; index += 1) {
		const log = result.logs.at(index);
		pane.rows.push({
			id: log.id,
			kind: 'log',
			result,
			log,
			location: log.location,
			expandable: false,
			expanded: false,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
	}
	const fsmTrace = result.fsmTransitionTrace;
	if (fsmTrace !== null) {
		for (let index = 0; index < fsmTrace.transitions.length; index += 1) {
			const transition = fsmTrace.transitions.at(index);
			pane.rows.push({
				id: transition.id,
				kind: 'fsm_transition',
				result,
				trace: fsmTrace,
				transition,
				expandable: false,
				expanded: false,
				text: '',
				twistieLeft: 0,
				twistieRight: 0,
			});
		}
	}
	for (let index = 0; index < result.captures.length; index += 1) {
		const capture = result.captures.at(index);
		pane.rows.push({
			id: capture.id,
			kind: 'capture',
			result,
			capture,
			location: capture.location,
			expandable: false,
			expanded: false,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
	}
}

function retainedResultExists(state: ScenarioLabViewState, resultId: string): boolean {
	const results = state.resultService.results;
	for (let index = 0; index < results.length; index += 1) {
		if (results[index].id === resultId) {
			return true;
		}
	}
	return false;
}

function pruneExpandedScenarioResults(state: ScenarioLabViewState): void {
	const expandedResultIds = state.resultPane.expandedResultIds;
	for (const resultId of expandedResultIds) {
		if (!retainedResultExists(state, resultId)) {
			expandedResultIds.delete(resultId);
		}
	}
}

export function refreshScenarioLabProjection(state: ScenarioLabViewState): void {
	const testPane = state.testPane;
	const resultPane = state.resultPane;
	const resultService = state.resultService;
	if (testPane.rowsDirty) {
		rebuildScenarioLabTestRows(state);
	}
	if (resultPane.projectedRevision === resultService.revision
		&& resultPane.projectedTestId === testPane.selectedTestId) {
		return;
	}

	const selectedResultRowId = resultPane.selectionIndex >= 0
		? resultPane.rows[resultPane.selectionIndex].id
		: null;
	pruneExpandedScenarioResults(state);
	resultPane.rows.length = 0;
	let newestResultId: string | null = null;
	const selectedTestId = testPane.selectedTestId;
	const previousNewestResultId = resultPane.newestResultId;
	if (selectedTestId !== null) {
		const results = resultService.results;
		for (let index = 0; index < results.length; index += 1) {
			const result = results[index];
			if (result.test.id !== selectedTestId) {
				continue;
			}
			if (newestResultId === null) {
				newestResultId = result.id;
				if (result.id !== previousNewestResultId) {
					resultPane.expandedResultIds.add(result.id);
				}
			}
			appendScenarioResultRows(resultPane, result);
		}
	}
	const newestResultChanged = newestResultId !== previousNewestResultId;
	resultPane.newestResultId = newestResultId;
	resultPane.selectedTestHasResult = newestResultId !== null;
	resultPane.selectionIndex = findScenarioLabRowIndex(
		resultPane.rows,
		newestResultChanged ? newestResultId : selectedResultRowId,
	);
	if (resultPane.selectionIndex < 0 && resultPane.rows.length > 0) {
		resultPane.selectionIndex = 0;
	}
	resultPane.projectedRevision = resultService.revision;
	resultPane.projectedTestId = selectedTestId;
	resultPane.hoverIndex = -1;
	testPane.textDirty = true;
	resultPane.textDirty = true;
}

export function selectedScenarioTest(state: ScenarioLabViewState): ScenarioTestItem | null {
	const pane = state.testPane;
	return pane.selectionIndex < 0 ? null : pane.rows[pane.selectionIndex].test;
}

export function selectedScenarioResultRow(state: ScenarioLabViewState): ScenarioLabResultRow | null {
	const pane = state.resultPane;
	return pane.selectionIndex < 0 ? null : pane.rows[pane.selectionIndex];
}

export function updateScenarioTestResultStates(state: ScenarioLabViewState): void {
	const rows = state.testPane.rows;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (row.kind === 'root') {
			row.latestState = null;
			continue;
		}
		const latest = latestResultForTest(state, row.test.id);
		if (latest === null) {
			row.latestState = null;
		} else {
			row.latestState = latest.state;
		}
	}
}
