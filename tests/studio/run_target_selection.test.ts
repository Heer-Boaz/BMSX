import assert from 'node:assert/strict';
import test from 'node:test';
import { RunTargetSelection, type WorkbenchRunTarget } from '../../ide/workbench/services/execution/run_target';

// Selection retains physical-owner identity without calling its collaborators.
// Real transport/audio/session admission is exercised by play_service.test.ts.
test('run selection starts with its designated primary, or with no execution attachment', () => {
	const primary = {} as WorkbenchRunTarget, selection = new RunTargetSelection(primary);
	assert.equal(selection.primary, primary);
	assert.equal(selection.selected, primary);
	const sourceOnly = new RunTargetSelection();
	assert.equal(sourceOnly.primary, undefined);
	assert.equal(sourceOnly.selected, undefined);
});

test('asynchronous admission preserves selection until completion and cannot override a newer explicit choice', () => {
	const primary = {} as WorkbenchRunTarget, play = {} as WorkbenchRunTarget;
	const selection = new RunTargetSelection(primary), request = selection.request();
	assert.equal(selection.selected, primary);
	selection.select(primary);
	assert.equal(selection.complete(request, play), false, 'explicitly retaining primary supersedes pending Play admission');
	assert.equal(selection.selected, primary);
	const older = selection.request(), newer = selection.request();
	assert.equal(selection.complete(older, play), false);
	assert.equal(selection.complete(newer, play), true);
	assert.equal(selection.selected, play);
	assert.equal(selection.complete(newer, primary), false, 'one admission request cannot select twice');
});

test('retiring the selected physical owner clears selection with no primary fallback', () => {
	const primary = {} as WorkbenchRunTarget, play = {} as WorkbenchRunTarget;
	const selection = new RunTargetSelection(primary), changes: Array<WorkbenchRunTarget | undefined> = [];
	const unbind = selection.onDidChange(target => changes.push(target));
	selection.select(play);
	selection.select(play);
	selection.retire(primary);
	assert.equal(selection.selected, play);
	selection.retire(play);
	assert.equal(selection.selected, undefined);
	assert.equal(selection.primary, primary);
	assert.deepEqual(changes, [play, undefined]);
	unbind();
	selection.select(primary);
	assert.deepEqual(changes, [play, undefined]);
});

test('closing an unrelated old target does not cancel pending admission, while explicit clear does', () => {
	const primary = {} as WorkbenchRunTarget, old = {} as WorkbenchRunTarget, next = {} as WorkbenchRunTarget;
	const selection = new RunTargetSelection(primary), request = selection.request();
	selection.retire(old);
	assert.equal(selection.complete(request, next), true);
	const pending = selection.request();
	selection.select(undefined);
	assert.equal(selection.complete(pending, primary), false);
	assert.equal(selection.selected, undefined);
});
