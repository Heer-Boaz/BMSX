import {
	refreshScenarioLabProjection,
	selectedScenarioResultRow,
	selectedScenarioTestNode,
	updateSelectedScenarioNode,
} from './projection';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import { revealWorkbenchListSelection } from '../../ui/list_view';
import type { ScenarioLabViewState } from './view_model';
import type { ScenarioSourceLocation } from '../../../testing/scenario/result_service';

export type ScenarioLabNavigationCommand =
	| 'up'
	| 'down'
	| 'page-up'
	| 'page-down'
	| 'home'
	| 'end'
	| 'left'
	| 'right'
	| 'focus-next'
	| 'activate';

export type ScenarioLabNavigationResult =
	| { readonly kind: 'none' }
	| { readonly kind: 'changed' }
	| { readonly kind: 'open-source'; readonly location: ScenarioSourceLocation }
	| {
		readonly kind: 'actioneffect-source';
		readonly executionDomain: 0 | 1;
		readonly effectId: string;
	};

const NAVIGATION_NONE: ScenarioLabNavigationResult = { kind: 'none' };
const NAVIGATION_CHANGED: ScenarioLabNavigationResult = { kind: 'changed' };

export function updateScenarioLabStatus(state: ScenarioLabViewState): void {
	if (state.focus === 'results') {
		const row = selectedScenarioResultRow(state);
		if (row !== null && row.kind === 'fsm_transition') {
			state.status.info = `FSM ${row.trace.instanceId} / SOURCE UNAVAILABLE`;
			state.status.dirty = true;
			return;
		}
		if (row !== null && row.kind === 'actioneffect_fact') {
			state.status.info = `ACTIONEFFECT ${row.fact.effectId} / OWNER ${row.trace.ownerId}`;
			state.status.dirty = true;
			return;
		}
	}
	const node = selectedScenarioTestNode(state);
	state.status.info = node === null ? 'NO SCENARIO SELECTED' : node.label.toUpperCase();
	state.status.dirty = true;
}

function selectScenarioTestRow(state: ScenarioLabViewState, index: number): void {
	state.testPane.selectionIndex = index;
	updateSelectedScenarioNode(state);
	refreshScenarioLabProjection(state);
	revealWorkbenchListSelection(state.testPane);
	updateScenarioLabStatus(state);
}

function selectScenarioResultRow(state: ScenarioLabViewState, index: number): void {
	state.resultPane.selectionIndex = index;
	revealWorkbenchListSelection(state.resultPane);
	updateScenarioLabStatus(state);
}

export function selectScenarioLabTestRow(state: ScenarioLabViewState, index: number): void {
	state.focus = 'tests';
	selectScenarioTestRow(state, index);
}

export function selectScenarioLabResultRow(state: ScenarioLabViewState, index: number): void {
	state.focus = 'results';
	selectScenarioResultRow(state, index);
}

export function toggleScenarioLabTestRow(state: ScenarioLabViewState, index: number): void {
	const row = state.testPane.rows[index];
	if (!row.expandable) {
		return;
	}
	if (row.expanded) {
		state.testPane.collapsedRootIds.add(row.root.id);
	} else {
		state.testPane.collapsedRootIds.delete(row.root.id);
	}
	state.testPane.rowsDirty = true;
	refreshScenarioLabProjection(state);
	revealWorkbenchListSelection(state.testPane);
	updateScenarioLabStatus(state);
}

export function toggleScenarioLabResultRow(state: ScenarioLabViewState, index: number): void {
	const row = state.resultPane.rows[index];
	if (!row.expandable) {
		return;
	}
	if (row.expanded) {
		state.resultPane.expandedResultIds.delete(row.id);
	} else {
		state.resultPane.expandedResultIds.add(row.id);
	}
	state.resultPane.projectedRevision = -1;
	refreshScenarioLabProjection(state);
	revealWorkbenchListSelection(state.resultPane);
	updateScenarioLabStatus(state);
}

function moveScenarioLabSelection(state: ScenarioLabViewState, delta: number): boolean {
	if (state.focus === 'tests') {
		if (state.testPane.rows.length === 0) {
			return false;
		}
		let next = state.testPane.selectionIndex + delta;
		if (next < 0) next = 0;
		if (next >= state.testPane.rows.length) next = state.testPane.rows.length - 1;
		if (next === state.testPane.selectionIndex) {
			return false;
		}
		selectScenarioTestRow(state, next);
		return true;
	}
	if (state.resultPane.rows.length === 0) {
		return false;
	}
	let next = state.resultPane.selectionIndex + delta;
	if (next < 0) next = 0;
	if (next >= state.resultPane.rows.length) next = state.resultPane.rows.length - 1;
	if (next === state.resultPane.selectionIndex) {
		return false;
	}
	selectScenarioResultRow(state, next);
	return true;
}

function moveScenarioLabBoundary(state: ScenarioLabViewState, end: boolean): boolean {
	const length = state.focus === 'tests' ? state.testPane.rows.length : state.resultPane.rows.length;
	if (length === 0) {
		return false;
	}
	const next = end ? length - 1 : 0;
	if (state.focus === 'tests') {
		if (next === state.testPane.selectionIndex) return false;
		selectScenarioTestRow(state, next);
		return true;
	}
	if (next === state.resultPane.selectionIndex) return false;
	selectScenarioResultRow(state, next);
	return true;
}

export function scenarioLabCommandEnabled(
	state: ScenarioLabViewState,
	command: EditorScenarioLabCommandId,
): boolean {
	switch (command) {
		case 'scenarioLab.run':
			return !state.runActive && selectedScenarioTestNode(state) !== null;
		case 'scenarioLab.rerun':
			return !state.runActive && state.resultService.runs.length > 0;
		case 'scenarioLab.cancel':
			return state.runActive;
	}
}

function activateScenarioLabSelection(state: ScenarioLabViewState): ScenarioLabNavigationResult {
	if (state.focus === 'tests') {
		const selectionIndex = state.testPane.selectionIndex;
		if (selectionIndex < 0) {
			return NAVIGATION_NONE;
		}
		const row = state.testPane.rows[selectionIndex];
		if (row.kind === 'root') {
			toggleScenarioLabTestRow(state, selectionIndex);
			return NAVIGATION_CHANGED;
		}
		return {
			kind: 'open-source',
			location: {
				resource: row.test.resource,
				line: 1,
				column: 1,
			},
		};
	}
	const row = selectedScenarioResultRow(state);
	if (row === null) {
		return NAVIGATION_NONE;
	}
	if (row.kind === 'run' || row.kind === 'result') {
		toggleScenarioLabResultRow(state, state.resultPane.selectionIndex);
		return NAVIGATION_CHANGED;
	}
	if (row.kind === 'fsm_transition') {
		updateScenarioLabStatus(state);
		return NAVIGATION_CHANGED;
	}
	if (row.kind === 'actioneffect_fact') {
		return {
			kind: 'actioneffect-source',
			executionDomain: row.trace.executionDomain,
			effectId: row.fact.effectId,
		};
	}
	return { kind: 'open-source', location: row.location };
}

function moveScenarioLabLeft(state: ScenarioLabViewState): boolean {
	if (state.focus === 'results') {
		state.focus = 'tests';
		updateScenarioLabStatus(state);
		return true;
	}
	const selectionIndex = state.testPane.selectionIndex;
	if (selectionIndex < 0) {
		return false;
	}
	const row = state.testPane.rows[selectionIndex];
	if (row.kind === 'root') {
		if (!row.expanded) return false;
		toggleScenarioLabTestRow(state, selectionIndex);
		return true;
	}
	for (let index = selectionIndex - 1; index >= 0; index -= 1) {
		if (state.testPane.rows[index].id === row.root.id) {
			selectScenarioTestRow(state, index);
			return true;
		}
	}
	return false;
}

function moveScenarioLabRight(state: ScenarioLabViewState): boolean {
	if (state.focus === 'results') {
		const row = selectedScenarioResultRow(state);
		if (row === null
			|| (row.kind !== 'run' && row.kind !== 'result')
			|| row.expanded) {
			return false;
		}
		toggleScenarioLabResultRow(state, state.resultPane.selectionIndex);
		return true;
	}
	const selectionIndex = state.testPane.selectionIndex;
	if (selectionIndex < 0) {
		return false;
	}
	const row = state.testPane.rows[selectionIndex];
	if (row.kind === 'root') {
		if (row.expanded) return false;
		toggleScenarioLabTestRow(state, selectionIndex);
		return true;
	}
	if (state.resultPane.rows.length === 0) {
		return false;
	}
	state.focus = 'results';
	updateScenarioLabStatus(state);
	return true;
}

export function executeScenarioLabNavigation(
	state: ScenarioLabViewState,
	command: ScenarioLabNavigationCommand,
): ScenarioLabNavigationResult {
	refreshScenarioLabProjection(state);
	switch (command) {
		case 'up':
			return moveScenarioLabSelection(state, -1)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'down':
			return moveScenarioLabSelection(state, 1)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'page-up':
			if (state.focus === 'tests') {
				return moveScenarioLabSelection(state, -state.testPane.layout.visibleRowCount)
					? NAVIGATION_CHANGED
					: NAVIGATION_NONE;
			}
			return moveScenarioLabSelection(
				state,
				-state.resultPane.layout.visibleRowCount,
			) ? NAVIGATION_CHANGED : NAVIGATION_NONE;
		case 'page-down':
			if (state.focus === 'tests') {
				return moveScenarioLabSelection(state, state.testPane.layout.visibleRowCount)
					? NAVIGATION_CHANGED
					: NAVIGATION_NONE;
			}
			return moveScenarioLabSelection(
				state,
				state.resultPane.layout.visibleRowCount,
			) ? NAVIGATION_CHANGED : NAVIGATION_NONE;
		case 'home':
			return moveScenarioLabBoundary(state, false)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'end':
			return moveScenarioLabBoundary(state, true)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'left':
			return moveScenarioLabLeft(state)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'right':
			return moveScenarioLabRight(state)
				? NAVIGATION_CHANGED
				: NAVIGATION_NONE;
		case 'focus-next':
			if (state.resultPane.rows.length === 0) return NAVIGATION_NONE;
			state.focus = state.focus === 'tests' ? 'results' : 'tests';
			updateScenarioLabStatus(state);
			return NAVIGATION_CHANGED;
		case 'activate':
			return activateScenarioLabSelection(state);
	}
}
