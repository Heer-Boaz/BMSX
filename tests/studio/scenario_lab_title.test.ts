import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { ScenarioResultService } from '../../ide/testing/scenario/result_service';
import { ScenarioTestCollection } from '../../ide/testing/scenario/test_collection';
import { prepareScenarioLabLayout } from '../../ide/workbench/contrib/scenario_lab/layout';
import { scenarioLabCommandEnabled, selectScenarioLabTestRow, updateScenarioLabStatus } from '../../ide/workbench/contrib/scenario_lab/navigation';
import { createScenarioLabViewState } from '../../ide/workbench/contrib/scenario_lab/view_state';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const BOUNDS = { left: 0, top: 24, right: 384, bottom: 276 };

function fixture(t: TestContext) {
	const font = editorViewState.font, lineHeight = editorViewState.lineHeight, charAdvance = editorViewState.charAdvance;
	editorViewState.font = new EditorFont('tiny');
	editorViewState.lineHeight = editorViewState.font.lineHeight;
	editorViewState.charAdvance = editorViewState.font.advance('M');
	t.after(() => { editorViewState.font = font; editorViewState.lineHeight = lineHeight; editorViewState.charAdvance = charAdvance; });
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 1),
	]).catalog);
	const results = new ScenarioResultService(), view = createScenarioLabViewState(collection, results, false);
	prepareScenarioLabLayout(view, BOUNDS);
	return { collection, results, view };
}

test('Scenario title membership belongs to each retained view while commands retain their own capability', t => {
	const { collection, results, view } = fixture(t), other = createScenarioLabViewState(collection, results, true);
	prepareScenarioLabLayout(other, BOUNDS);
	const actions = view.actionBar, title = actions.menu!, otherTitle = other.actionBar.menu!;
	const debug = actions.items.find(item => item.command === 'scenarioLab.debug')!;
	assert.equal(debug.visible, true);
	assert.equal(actions.items.find(item => item.command === 'scenarioLab.rerun')!.visible, true);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.rerun'), false, 'an idle placement does not grant a historical-run capability');
	assert.equal(other.actionBar.items.find(item => item.command === 'scenarioLab.debug')!.visible, false);
	assert.equal(other.actionBar.items.find(item => item.command === 'scenarioLab.cancel')!.visible, true);
	assert.notEqual(title, otherTitle);
	assert.equal(title.entries[0].item, otherTitle.entries[0].item, 'the immutable definition is shared without sharing retained membership');
	const otherRevision = otherTitle.revision;
	selectScenarioLabTestRow(view, view.testPane.rows.findIndex(row => row.kind === 'module'));
	prepareScenarioLabLayout(view, BOUNDS);
	assert.equal(debug.visible, false);
	assert.equal(otherTitle.revision, otherRevision);
	assert.deepEqual(actions.overflow!.secondary!.map(item => item.type === 'command' ? item.command : item.type),
		['scenarioLab.runWithCompanion', 'scenarioLab.debugWithCompanion', 'scenarioLab.playWithCompanion'],
		'companion actions retain their existing static context-menu contract');
});

test('Scenario title publishes transient run membership without reallocating retained presentation state', async t => {
	const { collection, results, view } = fixture(t), actions = view.actionBar, title = actions.menu!;
	const items = actions.items, entries = title.entries, visible = title.visibleItems, overflow = actions.overflow!.items;
	const debug = items.find(item => item.command === 'scenarioLab.debug')!, cancel = items.find(item => item.command === 'scenarioLab.cancel')!;
	const module = collection.resolveRoot(collection.roots[0].id)[0], test = module.children[0];
	const revision = title.revision;
	const run = results.beginRun(test.id, [{ test, source: module.source, sourceRevision: 1 }]);
	view.runActive = true;
	updateScenarioLabStatus(view);
	assert.ok(title.revision > revision);
	assert.equal(debug.visible, false, 'publication retracts an old action before stale geometry can be admitted');
	assert.equal(cancel.menuEntry!.visible, true);
	assert.equal(cancel.visible, false, 'new action geometry is not admitted by producer publication');
	const activeRevision = title.revision;
	await Promise.resolve();
	results.cancelRun(run);
	view.runActive = false;
	updateScenarioLabStatus(view);
	assert.ok(title.revision > activeRevision, 'A to B to A between layouts still invalidates the active menu lifetime');
	prepareScenarioLabLayout(view, BOUNDS);
	assert.equal(debug.visible, true);
	assert.equal(cancel.visible, false);
	assert.equal(items.find(item => item.command === 'scenarioLab.revealRun')!.visible, true);
	const settledRevision = title.revision, layoutRevision = actions.layoutRevision;
	for (let frame = 0; frame < 100; frame++) prepareScenarioLabLayout(view, BOUNDS);
	assert.equal(title.revision, settledRevision);
	assert.equal(actions.layoutRevision, layoutRevision);
	assert.equal(actions.items, items);
	assert.equal(title.entries, entries);
	assert.equal(title.visibleItems, visible);
	assert.equal(actions.overflow!.items, overflow);
	assert.equal(actions.items.find(item => item.command === debug.command), debug);
});

test('Scenario title refreshes source-selection membership before the unchanged-bounds geometry gate', t => {
	const { collection, view } = fixture(t), actions = view.actionBar, debug = actions.items.find(item => item.command === 'scenarioLab.debug')!;
	const module = collection.resolveRoot(collection.roots[0].id)[0], revision = actions.menu!.revision;
	collection.updateSource(module, "return { kind = 'unit', tests = {} }", 2);
	assert.equal(view.actionsDirty, false);
	prepareScenarioLabLayout(view, BOUNDS);
	assert.equal(view.testPane.rows[view.testPane.selectionIndex].kind, 'root');
	assert.equal(debug.visible, false);
	assert.ok(actions.menu!.revision > revision);
	assert.equal(view.actionsDirty, false, 'the membership change has been consumed by this layout, not deferred to another frame');
});
