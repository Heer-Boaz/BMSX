import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { OverlayRenderer } from '../../ide/runtime/overlay_renderer';
import {
	executeScenarioLabNavigation,
	scenarioLabCommandEnabled,
	selectScenarioLabResultRow,
} from '../../ide/workbench/contrib/scenario_lab/navigation';
import { refreshScenarioLabProjection } from '../../ide/workbench/contrib/scenario_lab/projection';
import { drawScenarioLab } from '../../ide/workbench/contrib/scenario_lab/render';
import { prepareScenarioLabLayout } from '../../ide/workbench/contrib/scenario_lab/layout';
import {
	SCENARIO_RESULT_LOG_RETAIN_COUNT,
	ScenarioResultService,
} from '../../ide/testing/scenario/result_service';
import { ScenarioTestCollection } from '../../ide/testing/scenario/test_collection';
import { createScenarioLabViewState } from '../../ide/workbench/contrib/scenario_lab/view_state';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import {
	createScenarioTestSourceRecord,
	createScenarioTestSourceState,
} from '../helpers/scenario_sources';

const VIEWPORT_WIDTH = 384;
const VIEWPORT_HEIGHT = 288;
const CODE_AREA_TOP = 24;
const CODE_AREA_BOTTOM = 276;

function installTinyWorkbenchViewport(t: TestContext): EditorFont {
	const previous = {
		font: editorViewState.font,
		lineHeight: editorViewState.lineHeight,
		charAdvance: editorViewState.charAdvance,
		viewportWidth: editorViewState.viewportWidth,
		viewportHeight: editorViewState.viewportHeight,
		codeAreaTop: editorViewState.codeAreaTop,
		codeAreaBottom: editorViewState.codeAreaBottom,
	};
	t.after(() => {
		editorViewState.font = previous.font;
		editorViewState.lineHeight = previous.lineHeight;
		editorViewState.charAdvance = previous.charAdvance;
		editorViewState.viewportWidth = previous.viewportWidth;
		editorViewState.viewportHeight = previous.viewportHeight;
		editorViewState.codeAreaTop = previous.codeAreaTop;
		editorViewState.codeAreaBottom = previous.codeAreaBottom;
	});
	const font = new EditorFont('tiny');
	editorViewState.font = font;
	editorViewState.lineHeight = font.lineHeight;
	editorViewState.charAdvance = font.advance('M');
	editorViewState.viewportWidth = VIEWPORT_WIDTH;
	editorViewState.viewportHeight = VIEWPORT_HEIGHT;
	editorViewState.codeAreaTop = CODE_AREA_TOP;
	editorViewState.codeAreaBottom = CODE_AREA_BOTTOM;
	return font;
}

function createViewFixture(t: TestContext) {
	installTinyWorkbenchViewport(t);
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
		createScenarioTestSourceRecord('tests/carts/nemesis_s/b_assert.lua', 20),
	]));
	const results = new ScenarioResultService();
	const view = createScenarioLabViewState(collection, results, false);
	return { collection, results, view };
}

test('scenario workbench view retains lazy test projection and contextual actions', (t) => {
	const { collection, view } = createViewFixture(t);
	const root = collection.roots[0];
	const testPane = view.testPane;
	const tests = root.children!;

	assert.equal(tests.length, 2);
	assert.deepEqual(testPane.rows.map(row => row.kind), ['root', 'test', 'test']);
	assert.equal(testPane.selectionIndex, 1);
	assert.equal(testPane.selectedNodeId, tests[0].id);
	assert.equal(tests[0].label, 'a');
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.run'), true);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.rerun'), false);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.cancel'), false);
	assert.equal(view.layout.font?.variant, 'tiny');
	assert.equal(view.layout.left, 0);
	assert.equal(view.layout.right, VIEWPORT_WIDTH);
	assert.match(testPane.rows[0].text, /NEMESIS_S \(2\)/);
	executeScenarioLabNavigation(view, 'up');
	assert.equal(testPane.selectedNodeId, root.id);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.run'), true);
	executeScenarioLabNavigation(view, 'down');

	executeScenarioLabNavigation(view, 'down');
	const selectedId = testPane.selectedNodeId;
	testPane.rowsDirty = true;
	refreshScenarioLabProjection(view);
	assert.equal(testPane.selectedNodeId, selectedId);
	assert.equal(testPane.selectionIndex, 2);

	view.runActive = true;
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.run'), false);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.cancel'), true);
});

test('scenario result projection follows a new run and preserves stable log identity', (t) => {
	const { collection, results, view } = createViewFixture(t);
	const testItem = collection.roots[0].children![0];
	const resultPane = view.resultPane;
	const firstRun = results.beginRun(
		testItem.id,
		[{ test: testItem, sourceRevision: 7 }],
	);
	const first = results.startItem(firstRun, 0, 100);
	results.markRunning(first);
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT; index += 1) {
		results.appendLog(first, index, `log ${index}`);
	}
	refreshScenarioLabProjection(view);

	assert.equal(resultPane.rows[0].id, firstRun.id);
	assert.equal(resultPane.rows[0].expanded, true);
	assert.equal(resultPane.rows[1].id, first.id);
	assert.equal(resultPane.rows[1].expanded, true);
	selectScenarioLabResultRow(view, 3);
	let selectedResult = resultPane.rows[resultPane.selectionIndex];
	const retainedLogId = selectedResult.id;
	results.appendLog(first, SCENARIO_RESULT_LOG_RETAIN_COUNT, 'overflow log');
	refreshScenarioLabProjection(view);
	selectedResult = resultPane.rows[resultPane.selectionIndex];
	assert.equal(selectedResult.id, retainedLogId);
	assert.equal(resultPane.selectionIndex, 2);

	results.pass(first, 200);
	results.completeRun(firstRun);
	const secondRun = results.beginRun(
		testItem.id,
		[{ test: testItem, sourceRevision: 8 }],
	);
	const second = results.startItem(secondRun, 0, 201);
	view.runActive = true;
	refreshScenarioLabProjection(view);
	selectedResult = resultPane.rows[resultPane.selectionIndex];
	assert.equal(selectedResult.id, secondRun.id);
	assert.equal(resultPane.selectionIndex, 0);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.rerun'), false);
	results.cancel(second, 202);
	results.cancelRun(secondRun);
	view.runActive = false;
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.rerun'), true);
});

test('scenario result projection retains FSM facts without inventing source navigation', (t) => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children![0];
	const run = results.beginRun(item.id, [{ test: item, sourceRevision: 7 }]);
	const result = results.startItem(run, 0, 100);
	const trace = results.beginFsmTransitionTrace(
		result,
		'nemesis_s.director.nemesis_s.director.fsm',
		'nemesis_s.director.fsm',
	);
	results.appendFsmTransition(
		trace,
		1,
		1200,
		123,
		'nemesis_s.director.fsm:/gameplay',
		'nemesis_s.director.fsm:/gameplay/running',
		'nemesis_s.director.fsm:/gameplay/pause',
		'committed',
	);
	refreshScenarioLabProjection(view);
	prepareScenarioLabLayout(view);

	const factIndex = view.resultPane.rows.findIndex(row => row.kind === 'fsm_transition');
	assert.ok(factIndex > 0);
	const factRow = view.resultPane.rows[factIndex];
	assert.match(factRow.text, /FSM \[OK\] RUNNING > PAUSE/);
	selectScenarioLabResultRow(view, factIndex);
	const activation = executeScenarioLabNavigation(view, 'activate');
	assert.equal(activation.kind, 'changed');
	assert.match(view.status.info, /SOURCE UNAVAILABLE/);
});

test('scenario result projection retains ordered ActionEffect facts', (t) => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children![0];
	const run = results.beginRun(item.id, [{ test: item, sourceRevision: 7 }]);
	const result = results.startItem(run, 0, 100);
	const trace = results.beginActionEffectTrace(
		result,
		'nemesis_s.player.1',
		'nemesis_s.player',
	);
	results.appendActionEffectActivity(
		trace,
		1,
		1209,
		123,
		'fire_salvo',
		'activate',
		1,
	);
	results.appendActionEffectTrigger(
		trace,
		2,
		1210,
		124,
		'fire_salvo',
		'cooldown',
	);
	refreshScenarioLabProjection(view);
	prepareScenarioLabLayout(view);

	const factIndices = view.resultPane.rows.reduce<number[]>(
		(indices, row, index) => {
			if (row.kind === 'actioneffect_fact') {
				indices.push(index);
			}
			return indices;
		},
		[],
	);
	assert.equal(factIndices.length, 2);
	assert.match(
		view.resultPane.rows[factIndices[0]].text,
		/EFFECT ACTIVATE FIRE_SALVO X1/,
	);
	assert.match(
		view.resultPane.rows[factIndices[1]].text,
		/EFFECT TRIGGER \[NO:COOLDOWN\] FIRE_SALVO/,
	);
	selectScenarioLabResultRow(view, factIndices[1]);
	const activation = executeScenarioLabNavigation(view, 'activate');
	assert.deepEqual(activation, {
		kind: 'actioneffect-source',
		executionDomain: 0,
		effectId: 'fire_salvo',
	});
	assert.match(
		view.status.info,
		/ACTIONEFFECT fire_salvo \/ OWNER nemesis_s\.player\.1/,
	);
});

test('scenario workbench renderer uses the active tiny IDE font and retained text', (t) => {
	const tinyFont = installTinyWorkbenchViewport(t);
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const results = new ScenarioResultService();
	const view = createScenarioLabViewState(collection, results, false);
	const queue = new HostOverlayQueue();
	const renderer = new OverlayRenderer(queue);
	renderer.beginFrame({
		offscreenCanvasSize: { x: VIEWPORT_WIDTH, y: VIEWPORT_HEIGHT },
		viewportSize: { x: VIEWPORT_WIDTH, y: VIEWPORT_HEIGHT },
	});
	api.beginFrame(renderer);
	drawScenarioLab(view, {
		isEnabled: () => true,
	});
	renderer.endFrame();

	const frame = queue.consumeOverlayFrame();
	const renderFont = tinyFont.renderFont();
	let glyphCount = 0;
	let titleFound = false;
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] !== Host2DKind.Glyphs) {
			continue;
		}
		const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
		glyphCount += 1;
		assert.equal(glyphs.font, renderFont);
		if (glyphs.items === 'SCENARIO LAB') {
			titleFound = true;
		}
	}
	assert.ok(glyphCount >= 8);
	assert.equal(titleFound, true);
});
