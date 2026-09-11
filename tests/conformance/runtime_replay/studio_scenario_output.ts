import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import type { ScenarioLabEditorPane } from '../../../ide/workbench/contrib/scenario_lab/editor_pane';
import { SCENARIO_RESULT_LOG_RETAIN_COUNT } from '../../../ide/testing/scenario/result_service';
import type { EditorTextModel } from '../../../ide/editor/model/text_model';
import type { ScenarioTestResult } from '../../../ide/testing/scenario/result_service';
import type { ScenarioLabViewState, ScenarioLabResultRow } from '../../../ide/workbench/contrib/scenario_lab/view_model';
import { check, type StudioFixture } from './studio_fixture';

const EFFECTS = `local effects<const> = require('cartlib/actioneffects')
effects.register_effect('fixture.result', { handler = function(owner) owner.first = true end })

effects.register_effect('fixture.result', { handler = function(owner) owner.second = true end })
`;
const MESSAGE = `expected:\n\n${Array.from({ length: 65 }, (_, n) => `line_${n}: expected ${n}, actual ${n + 1}`).join('\n')}\n${'W'.repeat(240)}\nactual: final result`;

/** Independent result/source data through the actual Lab, inspector and Quick Input routes. */
export async function testStudioScenarioOutput(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, runPaletteCommand, cycles } = test;
	const origin = getActiveTab();
	harness.openLuaSource('cart.lua'); // Source transport only; the fixture defines its own effects.
	const model = activeCodeEditor.model, original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: EFFECTS }]);
	const version = model.version, dirty = model.dirty, position = cycles();
	await runPaletteCommand('Scenario Lab: Open');
	const lab = getActiveTab();
	if (lab.kind !== 'scenario_lab') throw new Error('A05: actual Lab input required');
	const view = lab.view, service = view.resultService;
	const testRow = view.testPane.rows.find(row => row.kind === 'test')!;
	if (testRow.kind !== 'test') throw new Error('A05: a test resource supplies context, not message content');
	// Choose its context through the real test list, independent of the cart's test names/content.
	if (view.focus === 'results') await press('Tab');
	if (view.actionBar.hasFocus) await press('Tab');
	await press('Home');
	for (let n = 0; n < view.testPane.rows.indexOf(testRow); n += 1) await press('ArrowDown');
	const run = service.beginRun(testRow.test.id, [{ test: testRow.test, sourceRevision: 1 }]);
	const result = service.startItem(run, 0, 50);
	service.appendLog(result, 51, MESSAGE);
	service.appendLog(result, 52, 'real source message', { resource: model.resource, line: 4, column: 1 });
	service.fail(result, 53, { message: MESSAGE }, null);
	service.completeRun(run);
	await frame(); await press('Tab');
	const pane = ide.editor.editorPanes.activePane as ScenarioLabEditorPane;
	const inspector = pane.inspector;
	const select = async (matches: (row: ScenarioLabResultRow) => boolean) => {
		const index = view.resultPane.rows.findIndex(matches);
		check(index >= 0, 'A05: requested retained result exists');
		await press('Home');
		for (let n = 0; n < index; n += 1) await press('ArrowDown');
		check(view.resultPane.rows[view.resultPane.selectionIndex] === view.resultPane.rows[index], 'A05: result keyboard route selected the actual record');
	};
	await select(row => row.kind === 'log' && row.log.text === MESSAGE);
	const selectedId = view.resultPane.rows[view.resultPane.selectionIndex].id;
	await press('Enter');
	check(getActiveTab() === lab, 'A05: activating output inspects the message, not an invented test-file source');
	check(inspector.visible && inspector.model.rows[0].element.value === MESSAGE, 'A05: original multiline output is available');
	check(!inspector.isEnabled('propertyInspector.source'), 'A05: host output has no fabricated source');
	const measured = inspector.model.rows[0];
	check(measured.value.includes('') && measured.value.some(line => line.includes('final result')),
		'A05: empty lines and expected/actual tail survive tiny-font layout');
	await press('PageDown');
	const scroll = inspector.model.viewport.scrollTop;
	check(scroll > 0, 'A05: full output is scrollable through the shared control');
	service.appendLog(result, 54, 'unrelated later log');
	await frame();
	check(inspector.visible && inspector.model.rows[0] === measured && inspector.model.viewport.scrollTop === scroll,
		'A05: new output does not reset inspection identity, measured content or scroll');
	for (let n = 0; n < 20; n += 1) await frame();
	check(model.version === version && model.dirty === dirty && cycles() === position, 'A05: reading results edits neither source nor guest state');
	await press('Escape');
	check(!inspector.visible && view.resultPane.rows[view.resultPane.selectionIndex].id === selectedId,
		'A05: Back returns focus and the exact result selection');
	await select(row => row.kind === 'failure');
	await runPaletteCommand('Scenario Lab: Inspect Result Message');
	check(inspector.visible && inspector.model.rows[0].element.value === MESSAGE, 'A05: shared Details command inspects failures too');
	for (const variant of ['msx', 'tiny'] as const) {
		ide.editor.setFontVariant(variant); await frame(); await frame();
		for (let n = 0; n < 8; n += 1) await press('PageDown');
		const viewport = inspector.model.viewport;
		check(viewport.scrollTop + viewport.height >= viewport.contentHeight,
			`A05: the complete failure tail is reachable at ${variant} font`);
		check(inspector.model.rows[0].element.value === MESSAGE && !inspector.isEnabled('propertyInspector.source'),
			'A05: font changes affect layout, not message data or source availability');
	}
	await press('Escape');
	await select(row => row.kind === 'log' && row.log.location !== undefined);
	await press('Enter');
	check(inspector.isEnabled('propertyInspector.source'), 'A05: real diagnostic source is enabled');
	await click(inspector.actionBar.items.find(item => item.command === 'propertyInspector.source')!.bounds);
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === 3,
		'A05: Source uses the message location, not its test context');
	await runPaletteCommand('Go: Back');
	check(getActiveTab() === lab && view.resultPane.rows[view.resultPane.selectionIndex].kind === 'log', 'A05: navigation Back restores retained result selection');
	await select(row => row.kind === 'log' && row.log.text === MESSAGE);
	await press('Enter');
	for (let n = 0; n < SCENARIO_RESULT_LOG_RETAIN_COUNT; n += 1) service.appendLog(result, 60 + n, `replacement ${n}`);
	await frame();
	check(!inspector.visible && view.resultPane.selectionIndex === -1, 'A05: evicted messages close instead of adopting the next log at the old ordinal');
	await select(row => row.kind === 'failure');
	await press('Enter');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive && !inspector.visible, 'A05: leaving the IDE disposes message inspection');
	await press('ControlRight', 'ShiftRight');
	await testScenarioEffectSourceChoice(test, lab.view, result, model);
	harness.openLuaSource(model.resource.path);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'A05: inspection and source choice add no edit/Undo operation');
	await test.clickTab(origin.id);
}

async function testScenarioEffectSourceChoice(
	test: StudioFixture,
	view: ScenarioLabViewState,
	result: ScenarioTestResult,
	model: EditorTextModel,
): Promise<void> {
	const { ide, press, frame, runPaletteCommand } = test;
	const service = view.resultService;
	const trace = service.beginActionEffectTrace(result, 'fixture.actor', 'fixture.definition');
	service.appendActionEffectActivity(trace, 1, 100, 80, 'fixture.result', 'activate', 1);
	await frame();
	const choose = async () => {
		await runPaletteCommand('Scenario Lab: Open');
		const index = view.resultPane.rows.findIndex(row => row.kind === 'actioneffect_fact');
		check(index >= 0, 'A05: independent effect result is projected');
		await press('Home');
		for (let n = 0; n < index; n += 1) await press('ArrowDown');
		await press('Enter');
		check(ide.editor.quickInput.visible && ide.editor.quickInput.title === 'ACTIONEFFECT SOURCES', 'A05: ambiguous effect origin offers a source choice');
	};
	await choose();
	const rows = ide.editor.quickInput.model.list.rows;
	check(rows.length === 2 && rows[0].item.detail !== rows[1].item.detail, 'A05: same-id definitions have distinct source coordinates');
	await press('ArrowDown'); await press('Enter');
	check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === 3, 'A05: choosing second occurrence navigates its exact source');
	await choose();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shift all source ranges\n' }]);
	check(!ide.editor.quickInput.visible, 'A05: source edits expire the occurrence choice before stale ranges can be accepted');
	model.undo();
	await choose();
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.quickInput.visible && !ide.editor.isActive, 'A05: detaching workbench closes the source choice');
	await press('ControlRight', 'ShiftRight');
}
