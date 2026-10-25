import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';

import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import * as colors from '../../ide/common/constants';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { contrastRatio } from '../helpers/contrast.mjs';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import {
	executeScenarioLabNavigation,
	revealScenarioRun,
	scenarioLabCommandEnabled,
	selectScenarioLabResultRow,
} from '../../ide/workbench/contrib/scenario_lab/navigation';
import { refreshScenarioLabProjection } from '../../ide/workbench/contrib/scenario_lab/projection';
import { drawScenarioLab } from '../../ide/workbench/contrib/scenario_lab/render';
import { prepareScenarioLabLayout, measureScenarioLabMinimumWidth } from '../../ide/workbench/contrib/scenario_lab/layout';
import { handleScenarioLabPointerInput, ScenarioLabPointerResult } from '../../ide/workbench/contrib/scenario_lab/pointer';
import { WORKBENCH_ICON_SIZE } from '../../ide/workbench/ui/icon';
import { ScenarioLabRowFeedback } from '../../ide/workbench/contrib/scenario_lab/feedback';
import { scenarioModuleCaptions, scenarioTestIdentity } from '../../ide/workbench/contrib/scenario_lab/labels';
import { InputFocusService } from '../../ide/input/focus';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { ScenarioLabNavigationSelection } from '../../ide/workbench/contrib/scenario_lab/navigation_selection';
import { describeScenarioMessage, describeScenarioMessageDetails, describeScenarioTestResult } from '../../ide/workbench/contrib/scenario_lab/message_inspection';
import { WorkbenchPropertyInspectorModel } from '../../ide/workbench/ui/property_inspector/model';
import {
	SCENARIO_RESULT_LOG_RETAIN_COUNT,
	ScenarioResultService,
} from '../../ide/testing/scenario/result_service';
import { ScenarioTestCollection, scenarioTestId } from '../../ide/testing/scenario/test_collection';
import { createScenarioLabViewState } from '../../ide/workbench/contrib/scenario_lab/view_state';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import {
	createScenarioTestSourceRecord,
	createScenarioTestSourceState,
} from '../helpers/scenario_sources';

const VIEWPORT_WIDTH = 384;
const VIEWPORT_HEIGHT = 288;
const CODE_AREA_TOP = 24;
const CODE_AREA_BOTTOM = 276;

function installWorkbenchViewport(t: TestContext, variant: 'tiny' | 'msx' = 'tiny'): EditorFont {
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
	const font = new EditorFont(variant);
	editorViewState.font = font;
	editorViewState.lineHeight = font.lineHeight;
	editorViewState.charAdvance = font.advance('M');
	editorViewState.viewportWidth = VIEWPORT_WIDTH;
	editorViewState.viewportHeight = VIEWPORT_HEIGHT;
	editorViewState.codeAreaTop = CODE_AREA_TOP;
	editorViewState.codeAreaBottom = CODE_AREA_BOTTOM;
	return font;
}

function createViewFixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny') {
	installWorkbenchViewport(t, variant);
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
		createScenarioTestSourceRecord('tests/carts/nemesis_s/b_assert.lua', 20),
	]));
	const results = new ScenarioResultService();
	const view = createScenarioLabViewState(collection, results, false);
	prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: VIEWPORT_WIDTH, bottom: CODE_AREA_BOTTOM });
	return { collection, results, view };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`Scenario ${variant} module captions use their actual root without changing authored case/source membership`, t => {
		const font = installWorkbenchViewport(t, variant);
		const records = ['nemesis_s_bel_encounter', 'nemesis_s_cinematic_flow', 'different_project_intro', 'nemesis_s_intro', 'intro', 'a/same', 'b/same']
			.map((name, index) => createScenarioTestSourceRecord(`tests/carts/nemesis_s/${name}_assert.lua`, index));
		const sources = createScenarioTestSourceState(records), collection = new ScenarioTestCollection(sources);
		const root = collection.roots[0], view = createScenarioLabViewState(collection, new ScenarioResultService(), false);
		prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: 222, bottom: CODE_AREA_BOTTOM });
		const rows = view.testPane.rows.filter(row => row.kind === 'module');
		assert.equal(rows.find(row => row.module.label === 'nemesis_s_bel_encounter')!.caption, 'bel_encounter');
		assert.equal(rows.find(row => row.module.label === 'nemesis_s_cinematic_flow')!.caption, 'cinematic_flow');
		assert.equal(rows.find(row => row.module.label === 'different_project_intro')!.caption, 'different_project_intro');
		assert.equal(rows.find(row => row.module.label === 'nemesis_s_intro')!.caption, 'nemesis_s_intro', 'an exact namespace elision cannot collide with an already unqualified sibling');
		assert.equal(new Set(rows.map(row => row.caption)).size, rows.length, 'duplicate original basenames use their real distinct source paths');
		const encounter = rows.find(row => row.caption === 'bel_encounter')!, cinematic = rows.find(row => row.caption === 'cinematic_flow')!;
		assert.notEqual(encounter.text, cinematic.text, 'the constrained first glyphs identify different modules');
		for (const row of rows) {
			assert.ok(font.measure(row.text) <= view.testPane.layout.contentRight - row.textLeft - 4);
			assert.ok(row.feedbackText.includes(row.module.resource.path));
		}
		const item = encounter.module.children[0], testRowIndex = view.testPane.rows.findIndex(row => row.kind === 'test' && row.test === item);
		assert.equal(view.testPane.rows[testRowIndex].caption, 'sample', 'authored case names are never stripped or synthesized');
		view.testPane.selectionIndex = testRowIndex;
		const source = executeScenarioLabNavigation(view, 'activate');
		assert.deepEqual(source, { kind: 'open-source', location: { resource: item.resource, line: item.range.start.line, column: item.range.start.column } });
		assert.equal(item.id, scenarioTestId(0, item.assetId, 'sample'));
		assert.equal(scenarioModuleCaptions({ ...root, label: 'different_project' }).get(encounter.module), 'nemesis_s_bel_encounter', 'a different root cannot elide another project namespace');
		const otherSlot = { ...item, resource: { ...item.resource, domain: 1 as const }, id: scenarioTestId(1, item.assetId, item.caseName) };
		assert.notEqual(scenarioTestIdentity(item), scenarioTestIdentity(otherSlot), 'same source and case in another physical cartridge retains distinct membership');
		assert.notEqual(scenarioTestIdentity(item), scenarioTestIdentity(cinematic.module.children[0]), 'same authored case in another module retains distinct source identity');
		assert.deepEqual(records.map(record => record.src), records.map(() => "return { kind = 'unit', tests = { sample = function() end } }"));
		const retainedRows = view.testPane.rows.slice(), retainedTexts = view.testPane.rows.map(row => row.feedbackText);
		for (let frame = 0; frame < 1000; frame++) prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: 222, bottom: CODE_AREA_BOTTOM });
		assert.ok(view.testPane.rows.every((row, index) => row === retainedRows[index] && row.feedbackText === retainedTexts[index]));
	});
}

function scenarioFeedbackFixture(t: TestContext, variant: 'tiny' | 'msx') {
	const { view, collection, results } = createViewFixture(t, variant), font = editorViewState.font.renderFont();
	prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: 222, bottom: CODE_AREA_BOTTOM });
	const surfaces = new WorkbenchSurfaceService(), focus = new InputFocusService();
	const parent = focus.createTarget(), testsFocus = focus.createTarget(parent), resultsFocus = focus.createTarget(parent);
	parent.bindKeyboard(() => {}); testsFocus.bindKeyboard(() => {}); resultsFocus.bindKeyboard(() => {});
	const area = { left: 0, top: CODE_AREA_TOP, right: VIEWPORT_WIDTH, bottom: CODE_AREA_BOTTOM };
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('Scenario'), isVisible: () => true,
		getBounds: () => area, getClip: () => area, draw() {} });
	const feedback = new ScenarioLabRowFeedback(surfaces, owner, area, testsFocus, resultsFocus);
	let measurements = 0;
	const measure = (text: string, from: number, to: number) => { measurements++; return font.measure(text.slice(from, to)); };
	const measureText = (text: string) => { measurements++; return font.measure(text); };
	const labels: string[] = []; t.mock.method(api, 'blit_text_inline_with_font', label => labels.push(label));
	const overlay = createHostOverlayFixture(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	const update = () => feedback.update(font, measure, measureText);
	const paint = () => { labels.length = 0; overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame(); };
	t.after(() => { feedback.dispose(); surfaces.dispose(); });
	const point = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: 40, viewportY: view.testPane.layout.contentTop + view.testPane.layout.rowHeight + 2 };
	return { view, collection, results, surfaces, owner, area, parent, testsFocus, resultsFocus, feedback, labels, paint, point, update, measurements: () => measurements };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`Scenario ${variant} row feedback exposes full qualified membership for pointer and keyboard without idle formatting`, t => {
		const f = scenarioFeedbackFixture(t, variant), row = f.view.testPane.rows[1];
		f.view.testPane.hoverIndex = 1; f.feedback.pointer(f.view, f.point); f.update(); f.paint();
		assert.ok(f.labels.join('').includes(row.identity));
		assert.equal(f.surfaces.hitTest(f.point.viewportX, f.point.viewportY), f.owner, 'identity feedback is passive');
		const measured = f.measurements();
		for (let frame = 0; frame < 1000; frame++) f.update();
		assert.equal(f.measurements(), measured, 'stable row feedback does not remeasure/rebuild strings');
		f.feedback.onPointerLeave(); f.paint(); assert.deepEqual(f.labels, []);
		f.view.testPane.selectionIndex = 2; f.testsFocus.focus(); f.feedback.keyboardSelection(f.view); f.update(); f.paint();
		assert.ok(f.labels.join('').includes(f.view.testPane.rows[2].identity.replace('\n', '')));
		f.parent.focus(); f.paint(); assert.deepEqual(f.labels, [], 'actual focus departure retires keyboard feedback immediately');
		f.view.testPane.hoverIndex = 1; f.feedback.pointer(f.view, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
		f.view.testPane.hoverIndex = -1; f.point.viewportX++; f.feedback.pointer(f.view, f.point); f.update(); f.paint();
		assert.deepEqual(f.labels, [], 'the pane header and empty list space are not row feedback anchors');
		f.view.testPane.hoverIndex = 1; f.point.viewportX++; f.feedback.pointer(f.view, f.point); f.update();
		f.view.testPane.scroll += 1; f.update(); f.paint(); assert.deepEqual(f.labels, []);
		f.view.testPane.scroll -= 1; f.feedback.pointer(f.view, f.point); f.update(); f.paint(); assert.deepEqual(f.labels, [], 'stationary hover cannot adopt a row after scrolling');
		f.point.viewportX++; f.feedback.pointer(f.view, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
		f.view.testPane.rowsDirty = true; prepareScenarioLabLayout(f.view, { left: 0, top: CODE_AREA_TOP, right: 222, bottom: CODE_AREA_BOTTOM });
		f.update(); f.paint(); assert.deepEqual(f.labels, [], 'a reprojection with the same index cannot inherit source feedback');
		f.point.viewportX++; f.view.testPane.hoverIndex = 1; f.feedback.pointer(f.view, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
		const modal = f.surfaces.attach({ role: 'modal', blockedScope: null, captureScope: Symbol('modal'), isVisible: () => true,
			getBounds: () => f.area, getClip: () => f.area, draw() {} });
		f.paint(); assert.deepEqual(f.labels, []); modal.dispose();
		f.feedback.clear(); f.paint(); assert.deepEqual(f.labels, []);
		f.point.viewportX++; f.feedback.pointer(f.view, f.point); f.update(); f.paint(); assert.ok(f.labels.length > 0);
		f.owner.dispose(); f.update(); f.paint(); assert.deepEqual(f.labels, [], 'the actual surface lifetime owns feedback retirement');
	});
}

test('Scenario Lab observes shared discovery revisions even when another consumer refreshes them first', t => {
	const { collection, view } = createViewFixture(t);
	const module = collection.roots[0].children[0];
	const source = "return { kind = 'unit', tests = { newly_discovered = function() end } }";
	collection.updateSource(module, source, 42);
	assert.equal(view.testPane.rowsDirty, false, 'there is no controller-local invalidation');
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.testPane.projectedRevision, collection.revision);
	assert.ok(view.testPane.rows.some(row => row.kind === 'test' && row.test.caseName === 'newly_discovered'));
	const rows = view.testPane.rows.slice();
	for (let frame = 0; frame < 1000; frame++) prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.ok(view.testPane.rows.every((row, index) => row === rows[index]), 'unchanged frames retain rows');
});

test('result Details reads the captured suite without substituting current declarations or source navigation', t => {
	const { collection, results } = createViewFixture(t);
	const module = collection.roots[0].children[0], item = module.children[0];
	const source = '-- exact 🐉\r\n' + module.source;
	const run = results.beginRun(item.id, [{ test: item, source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	results.fail(result, 1, { message: 'failure' }, null); results.completeRun(run);
	collection.updateSource(module, '-- later bytes\n' + module.source, 2);
	const properties = describeScenarioTestResult(result);
	assert.equal(properties[0].value, 'failed');
	assert.equal(properties[2].value, source);
	assert.ok(properties.every(property => property.location === undefined));
});

test('scenario workbench view retains lazy test projection and contextual actions', (t) => {
	const { collection, view } = createViewFixture(t);
	const root = collection.roots[0];
	const testPane = view.testPane;
	const tests = collection.resolveNode(root);

	assert.equal(tests.length, 2);
	assert.deepEqual(testPane.rows.map(row => row.kind), ['root', 'module', 'test', 'module', 'test']);
	assert.equal(testPane.selectionIndex, 2);
	assert.equal(testPane.selectedNodeId, tests[0].id);
	assert.equal(tests[0].label, 'sample');
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.run'), true);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.rerun'), false);
	assert.equal(scenarioLabCommandEnabled(view, 'scenarioLab.cancel'), false);
	assert.equal(view.layout.font?.variant, 'tiny');
	assert.equal(view.layout.left, 0);
	assert.equal(view.layout.right, VIEWPORT_WIDTH);
	assert.match(testPane.rows[0].text, /NEMESIS_S \(2\)/);
	executeScenarioLabNavigation(view, 'up');
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
	const testItem = collection.roots[0].children[0].children[0];
	const resultPane = view.resultPane;
	const firstRun = results.beginRun(
		testItem.id,
		[{ test: testItem, source: collection.findModuleBySourcePath(testItem.resource.domain, testItem.resource.path).source, sourceRevision: 7 }],
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

	results.complete(first, 200);
	results.completeRun(firstRun);
	const secondRun = results.beginRun(
		testItem.id,
		[{ test: testItem, source: collection.findModuleBySourcePath(testItem.resource.domain, testItem.resource.path).source, sourceRevision: 8 }],
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

test('scenario messages activate their complete stored text without inventing a source location', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 20);
	const text = `expected:\n\n${'W'.repeat(300)}\nactual:\nlast actual value`;
	results.appendLog(result, 21, text);
	results.fail(result, 22, { message: text }, null);
	refreshScenarioLabProjection(view);
	for (let index = 0; index < view.resultPane.rows.length; index += 1) {
		const row = view.resultPane.rows[index];
		if (row.kind !== 'log' && row.kind !== 'failure') continue;
		selectScenarioLabResultRow(view, index);
		const navigation = executeScenarioLabNavigation(view, 'activate');
		assert.equal(navigation.kind, 'inspect-message');
		if (navigation.kind !== 'inspect-message') throw new Error('message inspection expected');
		assert.equal(navigation.row, row);
		const property = describeScenarioMessage(navigation.row);
		assert.equal(property.value, text);
		assert.equal(property.location, undefined, 'test context is not a message source location');
		const inspector = new WorkbenchPropertyInspectorModel();
		inspector.setItems([property]);
		let measures = 0;
		const measure = (_value: string, start: number, end: number) => {
			measures += 1;
			return end - start;
		};
		const bounds = { left: 0, right: 80, top: 0, bottom: 80 };
		const font = editorViewState.font.renderFont();
		inspector.layout(font, measure, bounds);
		const lines = inspector.rows[0].value;
		assert.equal(lines[1], '', 'blank lines remain readable');
		assert.equal(lines.join('').replaceAll(' ', ''), text.replaceAll('\n', '').replaceAll(' ', ''));
		assert.equal(lines[lines.length - 1], 'last actual value');
		assert.ok(inspector.viewport.contentHeight > bounds.bottom);
		const measured = measures;
		for (let frame = 0; frame < 100; frame += 1) inspector.layout(font, measure, bounds);
		assert.equal(measures, measured, 'warmed frames reuse full measured content');
	}
});

test('scenario messages retain an actual diagnostic location separately from test context', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 2 }]);
	const result = results.startItem(run, 0, 0);
	const location = { resource: { domain: 0 as const, path: 'actors/independent.lua' }, line: 79, column: 6 };
	results.appendLog(result, 5, 'actual fault stack', location);
	results.fail(result, 5, { message: 'actual fault', location }, null);
	refreshScenarioLabProjection(view);
	const messages = view.resultPane.rows.filter(row => row.kind === 'log' || row.kind === 'failure');
	assert.equal(messages.length, 2);
	for (const row of messages) {
		assert.equal(describeScenarioMessage(row).location, location);
		assert.notEqual(location.resource.path, item.resource.path);
	}
	results.requestCapture(result, 5, 'frame');
	assert.equal('location' in result.captures.at(0), false, 'a capture does not fabricate a source site');
});

test('scenario Details exposes retained exception frames and phase, not only the row message', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	const stackTrace = 'TypeError: broken protocol\n    at install (execution_service.ts:100:7)';
	results.fail(result, 5, { message: 'broken protocol', stackTrace, phase: 'install' }, null);
	results.completeRun(run);
	refreshScenarioLabProjection(view);
	const row = view.resultPane.rows.find(row => row.kind === 'failure')!;
	if (row.kind !== 'failure') throw new Error('failure row expected');
	const property = describeScenarioMessage(row);
	assert.equal(property.value, stackTrace);
	assert.equal(property.location, undefined);
});

test('scenario Details navigates each retained source frame without fabricating locations for instruction frames', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	const origin = { resource: { domain: 1 as const, path: 'machine/bios/base.lua' }, line: 222, column: 3 };
	const callback = { resource: item.resource, line: 30, column: 3 };
	results.fail(result, 10, { message: 'assertion failed', location: origin }, {
		message: 'assertion failed',
		...origin,
		details: { luaStack: [
			{ kind: 'source', functionName: 'assert', workspacePath: origin.resource.path, ...origin },
			{ kind: 'source', functionName: 'test.update', workspacePath: item.resource.path, ...callback },
			{ kind: 'instruction', functionName: '<unknown>', executionDomainId: 0, instructionAddress: 0x08010400 },
		] },
	});
	refreshScenarioLabProjection(view);
	const row = view.resultPane.rows.find(row => row.kind === 'failure')!;
	if (row.kind !== 'failure') throw new Error('failure row expected');
	const details = describeScenarioMessageDetails(row);
	assert.equal(details.length, 4);
	assert.deepEqual(details[0].location, origin);
	assert.deepEqual(details[1].location, origin);
	assert.deepEqual(details[2].location, callback);
	assert.equal(details[3].location, undefined);
	assert.match(details[3].value, /pc 0x8010400/);
});

test('navigation restores a result by identity after log eviction and keeps the saved collapsed run', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT; index += 1) results.appendLog(result, index, `entry ${index}`);
	refreshScenarioLabProjection(view);
	selectScenarioLabResultRow(view, 4);
	const id = view.resultPane.rows[4].id;
	view.focus = 'results';
	const selected = new ScenarioLabNavigationSelection(view);
	t.after(() => selected.dispose());
	view.focus = 'tests';
	executeScenarioLabNavigation(view, 'down');
	assert.notEqual(view.testPane.selectedNodeId, item.id);
	results.appendLog(result, 999, 'shift visible ordinal');
	selected.restore(view); prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.focus, 'results');
	assert.equal(view.testPane.selectedNodeId, item.id);
	assert.equal(view.resultPane.rows[view.resultPane.selectionIndex].id, id);
	assert.equal(view.resultPane.selectionIndex, 3);
	// Collapsed expansion state must not be mistaken for a newly selected run.
	view.resultPane.expandedResultIds.clear();
	view.resultPane.projectedRevision = -1;
	refreshScenarioLabProjection(view);
	const collapsed = new ScenarioLabNavigationSelection(view);
	t.after(() => collapsed.dispose());
	view.focus = 'tests';
	executeScenarioLabNavigation(view, 'down'); refreshScenarioLabProjection(view);
	collapsed.restore(view); prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.resultPane.rows.length, 1);
	assert.equal(view.resultPane.rows[0].expanded, false);
	// Once an old log is evicted, history must not silently adopt the next row.
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT; index += 1) results.appendLog(result, 1000 + index, `new ${index}`);
	selected.restore(view); prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.resultPane.selectionIndex, -1);
});

test('live result eviction clears its selection until an actual new run or user selection', t => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	results.appendLog(result, 1, 'selected message');
	refreshScenarioLabProjection(view);
	selectScenarioLabResultRow(view, view.resultPane.rows.findIndex(row => row.kind === 'log'));
	for (let n = 0; n < SCENARIO_RESULT_LOG_RETAIN_COUNT; n += 1) results.appendLog(result, n + 2, `later ${n}`);
	refreshScenarioLabProjection(view);
	assert.equal(view.resultPane.selectionIndex, -1);
	results.appendLog(result, 600, 'another later message');
	refreshScenarioLabProjection(view);
	assert.equal(view.resultPane.selectionIndex, -1, 'later refreshes cannot silently select a different subject');
	results.complete(result, 601);
	results.completeRun(run);
	const next = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 2 }]);
	refreshScenarioLabProjection(view);
	assert.equal(view.resultPane.rows[view.resultPane.selectionIndex].id, next.id, 'a new run is explicitly selected by its identity');
});

test('scenario result projection retains FSM facts without inventing source navigation', (t) => {
	const { collection, results, view } = createViewFixture(t);
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 7 }]);
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
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });

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
	const item = collection.roots[0].children[0].children[0];
	const run = results.beginRun(item.id, [{ test: item, source: collection.findModuleBySourcePath(item.resource.domain, item.resource.path).source, sourceRevision: 7 }]);
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
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });

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

test('scenario workbench renderer uses the active tiny IDE font', (t) => {
	const tinyFont = installWorkbenchViewport(t);
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([
		createScenarioTestSourceRecord('tests/carts/nemesis_s/a_assert.lua', 10),
	]));
	const results = new ScenarioResultService();
	const view = createScenarioLabViewState(collection, results, false);
	prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: VIEWPORT_WIDTH, bottom: CODE_AREA_BOTTOM });
	const { queue, renderer, presenter } = createHostOverlayFixture(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	renderer.beginFrame(presenter);
	api.beginFrame(renderer);
	drawScenarioLab(view);
	renderer.endFrame();

	const frame = queue.consumeOverlayFrame();
	const renderFont = tinyFont.renderFont();
	let glyphCount = 0;
	for (let index = 0; index < frame.commandCount; index += 1) {
		if (frame.commandKinds[index] !== Host2DKind.Glyphs) {
			continue;
		}
		const glyphs = frame.commandRefs[index] as GlyphRenderSubmission;
		glyphCount += 1;
		assert.equal(glyphs.font, renderFont);
	}
	assert.ok(glyphCount > 0, 'the actual text publication makes font ownership non-vacuous');
});

for (const variant of ['tiny', 'msx'] as const) test(`Scenario tree paint, indentation and disclosure hits share geometry in ${variant}`, t => {
	const { collection, results, view } = createViewFixture(t, variant);
	const sourceModule = collection.roots[0].children[0], item = sourceModule.children[0];
	const run = results.beginRun(item.id, [{ test: item, source: sourceModule.source, sourceRevision: 1 }]);
	const result = results.startItem(run, 0, 0);
	results.appendLog(result, 1, 'retained log');
	results.complete(result, 2); results.completeRun(run);
	prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: VIEWPORT_WIDTH, bottom: CODE_AREA_BOTTOM });
	const testPane = view.testPane, resultPane = view.resultPane;
	assert.deepEqual(resultPane.rows.map(row => row.depth), [0, 1, 2]);
	for (const pane of [testPane, resultPane]) {
		assert.ok(pane.layout.rowHeight >= WORKBENCH_ICON_SIZE + 2);
		assert.ok(pane.layout.rowHeight >= editorViewState.font.lineHeight + 2);
		for (const row of pane.rows) {
			assert.equal(row.twistieLeft, pane.layout.contentLeft + 4 + row.depth * pane.layout.indentWidth);
			assert.equal(row.textLeft, row.twistieRight + 2);
			assert.doesNotMatch(row.text, /^[+-]|^\s/, 'indentation/disclosure is geometry, not source-text padding');
		}
	}
	const { queue, renderer, presenter } = createHostOverlayFixture(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
	renderer.beginFrame(presenter); api.beginFrame(renderer); drawScenarioLab(view); renderer.endFrame();
	const frame = queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [], rectangles: RectRenderSubmission[] = [];
	for (let index = 0; index < frame.commandCount; index++) {
		if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
		else if (frame.commandKinds[index] === Host2DKind.Rect) rectangles.push(frame.commandRefs[index] as RectRenderSubmission);
	}
	for (const [pane, rowIndex] of [[resultPane, 1], [testPane, 1]] as const) {
		const row = pane.rows[rowIndex], top = pane.layout.contentTop + rowIndex * pane.layout.rowHeight;
		const text = glyphs.find(glyph => glyph.items === row.text)!;
		assert.equal(text.x, row.textLeft);
		assert.equal(text.y, top + ((pane.layout.rowHeight - editorViewState.font.lineHeight) >> 1));
		const iconLeft = row.twistieLeft + ((row.twistieRight - row.twistieLeft - WORKBENCH_ICON_SIZE) >> 1);
		const iconTop = top + ((pane.layout.rowHeight - WORKBENCH_ICON_SIZE) >> 1);
		const painted = rectangles.find(({ area }) => area.left >= iconLeft && area.right <= iconLeft + WORKBENCH_ICON_SIZE
			&& area.top >= iconTop && area.bottom <= iconTop + WORKBENCH_ICON_SIZE)!;
		assert.ok(painted, 'the expandable row did not paint its shared icon');
		assert.equal(handleScenarioLabPointerInput(view, { valid: true, insideViewport: true,
			viewportX: painted.area.left, viewportY: painted.area.top,
			pressedButtons: 1, justPressedButtons: 1, justReleasedButtons: 0 }, true, 1000 + rowIndex), ScenarioLabPointerResult.Handled);
		assert.equal(pane.rows[rowIndex].expanded, false, 'a press on a painted chevron pixel did not collapse its branch');
		assert.equal(pane.selectionIndex, rowIndex, 'the clicked branch did not become the keyboard cursor');
		assert.equal(view.focus, pane === resultPane ? 'results' : 'tests', 'the disclosure press focused a different pane');
	}
});


test('explicit run reveal expands ancestors; later results do not steal the selected test', t => {
	const { collection, results, view } = createViewFixture(t);
	const root = collection.roots[0], module = root.children[1], item = module.children[0];
	const initial = view.testPane.selectedNodeId;
	const run = results.beginRun(item.id, [{ test: item, source: module.source, sourceRevision: 1 }]);
	view.testPane.collapsedNodeIds.add(root.id); view.testPane.collapsedNodeIds.add(module.id);
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.testPane.selectedNodeId, initial, 'background results do not navigate');
	revealScenarioRun(view, run);
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.testPane.selectedNodeId, item.id);
	assert.equal(view.resultPane.rows[view.resultPane.selectionIndex].run, run);
	assert.equal(view.focus, 'results');
	const beforeRows = view.testPane.rows.slice();
	view.split.resize(0.7); prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.testPane.layout.contentRight, view.split.position);
	assert.ok(view.testPane.rows.every((row, i) => row === beforeRows[i]), 'resize lays out retained rows');
	view.focus = 'tests'; executeScenarioLabNavigation(view, 'home');
	const selection = view.testPane.selectedNodeId;
	const result = results.startItem(run, 0, 0); results.complete(result, 1); results.completeRun(run);
	prepareScenarioLabLayout(view, { left: 0, top: editorViewState.codeAreaTop, right: editorViewState.viewportWidth, bottom: editorViewState.codeAreaBottom });
	assert.equal(view.testPane.selectedNodeId, selection);
});

for (const theme of ['light', 'dark']) for (const variant of ['tiny', 'msx'] as const) {
	test(`Scenario ${theme}/${variant} state ink and header focus consume their actual surfaces`, t => {
		const originalTheme = colors.getActiveIdeThemeVariant();
		t.after(() => colors.setIdeThemeVariant(originalTheme)); colors.setIdeThemeVariant(theme);
		const overlay = createHostOverlayFixture(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
		for (const state of ['queued', 'preparing', 'running', 'passed', 'failed', 'cancelled', 'skipped'] as const) {
			const { collection, results, view } = createViewFixture(t, variant);
			const module = collection.roots[0].children[0], item = module.children[0];
			const run = results.beginRun(item.id, [{ test: item, source: module.source, sourceRevision: 1 }]);
			if (state === 'skipped') results.cancelRun(run);
			else if (state !== 'queued') {
				const result = results.startItem(run, 0, 0);
				if (state !== 'preparing') results.markRunning(result);
				if (state === 'passed') results.complete(result, 1);
				else if (state === 'failed') results.fail(result, 1, { message: 'expected failure' }, null);
				else if (state === 'cancelled') results.cancel(result, 1);
			}
			prepareScenarioLabLayout(view, { left: 0, top: CODE_AREA_TOP, right: VIEWPORT_WIDTH, bottom: CODE_AREA_BOTTOM });
			const rowIndex = view.testPane.rows.findIndex(row => row.kind === 'test' && row.test.id === item.id);
			const row = view.testPane.rows[rowIndex];
			assert.ok(row.kind === 'test');
			assert.equal(row.latestState, state);
			const top = view.testPane.layout.contentTop + rowIndex * view.testPane.layout.rowHeight;
			const expected = state === 'passed' ? colors.COLOR_CONTENT_SUCCESS_TEXT : state === 'failed' ? colors.COLOR_CONTENT_ERROR_TEXT
				: state === 'cancelled' || state === 'skipped' ? colors.COLOR_DESCRIPTION_TEXT : colors.COLOR_CONTENT_PROGRESS_TEXT;
			for (const focus of ['results', 'tests'] as const) {
				view.focus = focus; view.testPane.selectionIndex = rowIndex;
				overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); drawScenarioLab(view); overlay.renderer.endFrame();
				const frame = overlay.queue.consumeOverlayFrame();
				const glyphs: GlyphRenderSubmission[] = [], rectangles: RectRenderSubmission[] = [];
				for (let index = 0; index < frame.commandCount; index++) {
					if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
					else if (frame.commandKinds[index] === Host2DKind.Rect) rectangles.push(frame.commandRefs[index] as RectRenderSubmission);
				}
				const text = glyphs.find(glyph => glyph.x === row.textLeft && glyph.y === top + ((view.testPane.layout.rowHeight - editorViewState.lineHeight) >> 1))!;
				assert.equal(text.color, resolveThemeTokenColor(focus === 'tests' ? colors.COLOR_SELECTION_TEXT : expected));
				assert.ok(contrastRatio(text.color, resolveThemeTokenColor(focus === 'tests' ? colors.SELECTION_OVERLAY : colors.COLOR_RESOURCE_VIEWER_BACKGROUND)) >= 4.5);
				for (const title of ['TESTS', 'RESULTS']) assert.equal(glyphs.find(glyph => glyph.items === title)!.color, resolveThemeTokenColor(colors.COLOR_PROBLEMS_PANEL_HEADER_TEXT));
				const active = focus === 'tests' ? view.testPane.layout : view.resultPane.layout;
				assert.ok(rectangles.some(rect => rect.area.left === active.contentLeft && rect.area.right === active.contentRight
					&& rect.area.top === active.headerBottom - 1 && rect.area.bottom === active.headerBottom && rect.color === resolveThemeTokenColor(colors.COLOR_FOCUS_BORDER)));
			}
		}
	});
}

for (const variant of ['tiny', 'msx'] as const) test(`Scenario ${variant} companion minimum honors both clients at the retained inner ratio`, t => {
	const { view } = createViewFixture(t, variant), font = editorViewState.font;
	const indent = Math.max(editorViewState.charAdvance * 2, WORKBENCH_ICON_SIZE + 2);
	const testsBudget = editorViewState.charAdvance * 24 + indent * 3 + 10;
	const resultsBudget = editorViewState.charAdvance * 32 + indent * 3 + 10;
	for (const ratio of [0.15, 5 / 12, 0.85]) {
		view.split.resize(ratio);
		const retained = view.split.ratio, minimum = measureScenarioLabMinimumWidth(view);
		prepareScenarioLabLayout(view, { left: 23, top: 31, right: 23 + minimum, bottom: 231 });
		assert.equal(view.split.ratio, retained, 'measuring or arranging does not rewrite user placement intent');
		assert.ok(view.testPane.layout.contentRight - view.testPane.layout.contentLeft >= testsBudget);
		assert.ok(view.resultPane.layout.contentRight - view.resultPane.layout.contentLeft >= resultsBudget);
	}
	const advance = t.mock.method(font, 'advance');
	for (let frame = 0; frame < 1000; frame++) measureScenarioLabMinimumWidth(view);
	assert.equal(advance.mock.callCount(), 0);
});
