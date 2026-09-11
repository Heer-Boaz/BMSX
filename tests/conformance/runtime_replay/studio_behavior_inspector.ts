import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { problemsPanel } from '../../../ide/workbench/contrib/problems/panel/controller';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

const SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
local tasks<const> = {}
function tasks.walk_forward_out_of_room(owner)
${Array.from({ length: 70 }, (_, n) => `\towner.step_${n} = ${n}`).join('\n')}
end
trees.register('fixture.inspection', { root = {
	type = 'task', task = tasks.walk_forward_out_of_room,
	on_finished = function(owner)
${Array.from({ length: 70 }, (_, n) => `\towner.finished_${n} = ${n}`).join('\n')}
	end,
} })`;

/** Read the real constrained inspector, not a picker/layout mock or live cart-specific definition. */
export async function testStudioBehaviorInspector(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, runPaletteCommand, cycles } = test;
	harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model, original = model.buffer.getText(), position = cycles();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.inspection', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('inspection: actual BT graph required');
	const graph = lens.view.presentation, viewport = graph.viewport;
	await press('Home'); await press('ArrowDown');
	const selected = viewport.selection;
	if (selected?.kind !== 'node') throw new Error('inspection: authored task selection required');
	check(selected.lines[0] === 'TASK' && selected.lines.some(line => line.includes('TASKS.WALK_FORWARD_OUT_OF_ROOM'))
		&& !selected.lines.some(line => line.startsWith('CHILD ')), 'inspection: canvas identifies actual task, not its ordinal slot');
	const hadProblems = problemsPanel.isVisible;
	if (!hadProblems) await runPaletteCommand('View: Problems Panel');
	const version = model.version, dirty = model.dirty, geometry = viewport.model, x = viewport.scrollX, y = viewport.scrollY;
	const sourceSelection = lens.view.selection;
	await runPaletteCommand('Behavior Lens: Open Source Details');
	const inspector = (ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && !ide.editor.quickInput.visible, 'inspection: full property reader replaces the canvas, not its model or source');
	const targetIndex = inspector.model.rows.findIndex(row => row.element.label.endsWith('ON_FINISHED'));
	check(targetIndex >= 0, 'inspection: unknown extension field remains inspectable');
	for (let n = 0; n < targetIndex; n += 1) await press('ArrowDown');
	const property = inspector.model.rows[targetIndex];
	check(property.value.some(line => line.includes('OWNER.FINISHED_69')) && property.bottom - property.top > inspector.model.viewport.height,
		'inspection: complete multiline callback is retained past the viewport');
	check(inspector.model.viewport.bounds.right === 381 && inspector.model.viewport.bounds.bottom <= 240,
		'inspection: readable full width at 384x288 with Problems visible');
	for (let n = 0; n < 3; n += 1) await press('PageDown');
	check(inspector.model.viewport.scrollTop > property.top, 'inspection: page scrolling reaches the long value without changing property selection');
	for (let n = 0; n < 30; n += 1) await frame();
	check(inspector.model.rows[targetIndex] === property && model.version === version && model.dirty === dirty && cycles() === position,
		'inspection: idle/read/scroll keeps source, guest clock and measured content unchanged');
	console.info('STUDIO: complete behavior inspector with Problems ready for visual inspection');
	await press('Escape');
	check(!inspector.visible && viewport.model === geometry && viewport.selection === selected && lens.view.selection === sourceSelection
		&& viewport.scrollX === x && viewport.scrollY === y, 'inspection: Back retains the exact graph selection and pan');
	await runPaletteCommand('Behavior Lens: Open Source Details');
	for (let n = 0; n < targetIndex; n += 1) await press('ArrowDown');
	await click(inspector.actionBar.items[0].bounds, 30);
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.view.cursorRow === property.element.range!.start.line - 1
		&& model.version === version && cycles() === position, 'inspection: held Source opens the property, never inserts text or runs the guest');
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === lens && viewport.model === geometry, 'inspection: ordinary navigation Back restores the retained diagram');
	if (!hadProblems) await runPaletteCommand('View: Problems Panel');
	model.undo(); await frame();
	check(model.buffer.getText() === original, 'inspection: one ordinary Undo removes only the independent fixture');
}
