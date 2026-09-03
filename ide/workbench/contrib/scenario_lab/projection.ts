import type {
	ScenarioRun,
	ScenarioTestResult,
	ScenarioSourceLocation,
} from '../../../testing/scenario/result_service';
import type {
	ScenarioTestNode,
} from '../../../testing/scenario/test_collection';
import type {
	ScenarioLabResultPaneState,
	ScenarioLabResultRow,
	ScenarioLabTestPaneState,
	ScenarioLabTestRow,
	ScenarioLabViewState,
} from './view_model';

type ScenarioLabIdentifiedRow = ScenarioLabTestRow | ScenarioLabResultRow;

export function rebuildScenarioLabTestRows(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	const selectedId = pane.selectionIndex >= 0
		? pane.rows[pane.selectionIndex].id
		: pane.selectedNodeId;
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
	updateSelectedScenarioNode(state);
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

export function updateSelectedScenarioNode(state: ScenarioLabViewState): void {
	const pane = state.testPane;
	const nextId = pane.selectionIndex < 0
		? null
		: pane.rows[pane.selectionIndex].id;
	if (pane.selectedNodeId !== nextId) {
		pane.selectedNodeId = nextId;
		state.resultPane.projectedNodeId = null;
	}
}

function appendScenarioResultDetails(
	pane: ScenarioLabResultPaneState,
	run: ScenarioRun,
	result: ScenarioTestResult,
): void {
	const failure = result.failure;
	if (failure !== null) {
		pane.rows.push({
			id: `${result.id}:failure`,
			kind: 'failure',
			run,
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
			run,
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
				run,
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
	const actionEffectTrace = result.actionEffectTrace;
	if (actionEffectTrace !== null) {
		for (let index = 0; index < actionEffectTrace.facts.length; index += 1) {
			const fact = actionEffectTrace.facts.at(index);
			pane.rows.push({
				id: fact.id,
				kind: 'actioneffect_fact',
				run,
				result,
				trace: actionEffectTrace,
				fact,
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
			run,
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

function appendScenarioRunRows(
	pane: ScenarioLabResultPaneState,
	run: ScenarioRun,
): void {
	const expanded = pane.expandedResultIds.has(run.id);
	pane.rows.push({
		id: run.id,
		kind: 'run',
		run,
		result: null,
		expandable: true,
		expanded,
		text: '',
		twistieLeft: 0,
		twistieRight: 0,
	});
	if (!expanded) {
		return;
	}
	const items = run.items;
	for (let index = 0; index < items.length; index += 1) {
		const result = items[index];
		const resultExpanded = pane.expandedResultIds.has(result.id);
		const sourceLocation: ScenarioSourceLocation = {
			resource: result.test.resource,
			line: 1,
			column: 1,
		};
		pane.rows.push({
			id: result.id,
			kind: 'result',
			run,
			result,
			location: sourceLocation,
			expandable: true,
			expanded: resultExpanded,
			text: '',
			twistieLeft: 0,
			twistieRight: 0,
		});
		if (resultExpanded) {
			appendScenarioResultDetails(pane, run, result);
		}
	}
}

function retainedResultExists(state: ScenarioLabViewState, resultId: string): boolean {
	return state.resultService.hasRetainedResult(resultId);
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
		&& resultPane.projectedNodeId === testPane.selectedNodeId) {
		return;
	}

	const selectedResultRowId = resultPane.selectionIndex >= 0
		? resultPane.rows[resultPane.selectionIndex].id
		: null;
	pruneExpandedScenarioResults(state);
	resultPane.rows.length = 0;
	let newestRunId: string | null = null;
	const selectedNodeId = testPane.selectedNodeId;
	const previousNewestRunId = resultPane.newestRunId;
	if (selectedNodeId !== null) {
		const runs = resultService.runs;
		for (let index = 0; index < runs.length; index += 1) {
			const run = runs[index];
			if (run.scopeId !== selectedNodeId) {
				continue;
			}
			if (newestRunId === null) {
				newestRunId = run.id;
				if (run.id !== previousNewestRunId) {
					resultPane.expandedResultIds.add(run.id);
					resultPane.expandedResultIds.add(run.items[0].id);
				}
			}
			appendScenarioRunRows(resultPane, run);
		}
	}
	const newestRunChanged = newestRunId !== previousNewestRunId;
	resultPane.newestRunId = newestRunId;
	resultPane.selectionIndex = findScenarioLabRowIndex(
		resultPane.rows,
		newestRunChanged ? newestRunId : selectedResultRowId,
	);
	if (resultPane.selectionIndex < 0 && resultPane.rows.length > 0) {
		resultPane.selectionIndex = 0;
	}
	resultPane.projectedRevision = resultService.revision;
	resultPane.projectedNodeId = selectedNodeId;
	resultPane.hoverIndex = -1;
	testPane.textDirty = true;
	resultPane.textDirty = true;
}

export function selectedScenarioTestNode(state: ScenarioLabViewState): ScenarioTestNode | null {
	const pane = state.testPane;
	if (pane.selectionIndex < 0) {
		return null;
	}
	const row = pane.rows[pane.selectionIndex];
	return row.kind === 'root' ? row.root : row.test;
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
			const run = state.resultService.latestRunForScope(row.root.id);
			row.latestState = run === null ? null : run.state;
			continue;
		}
		const result = state.resultService.latestResultForTest(row.test.id);
		row.latestState = result === null ? null : result.state;
	}
}
