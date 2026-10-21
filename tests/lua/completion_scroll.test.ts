import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { WheelInputSnapshot } from '../../ide/common/models';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { drawCompletionPopupWithRenderer } from '../../ide/editor/render/completion';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { api } from '../../ide/runtime/overlay_api';
import { CompletionController } from '../../ide/workbench/contrib/code_editor/suggest/completion_controller';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

test('completion wheel scrolls continuously without changing selection; keyboard navigation reveals its selection', t => {
	t.after(() => {
		activeCodeEditor.detach();
		resetSemanticProjects(editorTextModelService);
		editorTextModelService.clear();
	});
	const resource = (path: string) => ({ domain: 0 as const, path, source: { resid: path, type: 'lua' as const, source_path: path } });
	const importer = editorTextModelService.retain(resource('carts/example/main.lua'), 'lua', "local m = require('authoring/')");
	for (let index = 0; index < 30; index += 1) editorTextModelService.retain(resource(`carts/example/authoring/module_${index}.lua`), 'lua', 'return {}');
	const view = createCodeEditorViewState();
	view.cursorColumn = importer.buffer.getText().indexOf("')");
	activeCodeEditor.attach(importer, view);
	class ReadyCompletionController extends CompletionController {
		protected override isCompletionReady() { return true; }
		protected override isCompletionContextActive() { return true; }
	}
	const controller = new ReadyCompletionController(createScenarioTestSourceState([]), null, null, null);
	controller.handleKeybindings(new KeyInputEvent('Space', KeyModifier.ctrl));
	const session = controller.session!;
	assert.ok(session);
	const selected = session.selectionIndex;
	for (const method of ['fill_rect', 'blit_rect', 'pushClipRect', 'popClipRect'] as const) t.mock.method(api, method, () => {});
	const rows: number[] = [];
	const labels: string[] = [];
	const render = (height = 240) => {
		controller.layoutPopup(height, 10);
		const offset = session.displayOffset;
		rows.length = 0;
		labels.length = 0;
		controller.popupBounds = drawCompletionPopupWithRenderer(session,
			{ row: 0, column: 0, x: 40, y: 30, width: 8, height: 10, baseChar: ' ', baseColor: 0 }, 10,
			{ codeTop: 0, codeBottom: height, codeLeft: 0, codeRight: 320, textLeft: 0 }, text => text.length * 8,
			(text, _x, y) => { rows.push(y); labels.push(text); }, controller.popupBoundsScratch);
		assert.equal(session.displayOffset, offset, 'painting consumes the viewport prepared by completion layout');
	};
	render();
	const firstY = rows[0];
	const stride = rows[1] - rows[0];
	const popup = controller.popupBounds!;
	const event: WheelInputSnapshot = { viewportX: popup.left + 2, viewportY: popup.top + 2, valid: true, insideViewport: true,
		modifiers: KeyModifier.none, deltaX: 0, deltaY: 0.25 };
	assert.equal(controller.handlePointerWheel(event), true);
	assert.equal(controller.handlePointerWheel(event), true);
	assert.equal(session.displayOffset, 0.5);
	assert.equal(session.selectionIndex, selected);
	render();
	assert.equal(session.displayOffset, 0.5, 'painting must not reveal the untouched selection over a wheel scroll');
	assert.equal(rows[0], firstY - stride / 2);
	assert.equal(controller.handlePointerWheel({ ...event, viewportX: popup.right + 1 }), false);
	assert.equal(session.displayOffset, 0.5);
	controller.handlePointerWheel({ ...event, deltaY: 3 });
	controller.handleKeybindings(new KeyInputEvent('ArrowDown', KeyModifier.none));
	assert.equal(session.selectionIndex, selected + 1);
	assert.equal(session.displayOffset, session.selectionIndex);
	for (let key = 0; key < 4; key++) controller.handleKeybindings(new KeyInputEvent('ArrowDown', KeyModifier.none));
	render();
	assert.equal(session.selectionIndex, selected + 5);
	assert.ok(labels.includes(session.filteredItems[session.selectionIndex].label));
	controller.layoutPopup(30, 10);
	assert.equal(session.maxVisibleItems, 2);
	assert.equal(session.displayOffset, session.selectionIndex - 1, 'shrinking the popup reveals its explicit selection before painting');
	render(30);
	assert.ok(labels.includes(session.filteredItems[session.selectionIndex].label));
	const smallPopup = controller.popupBounds!;
	controller.handlePointerWheel({ ...event, viewportX: smallPopup.left + 2, viewportY: smallPopup.top + 2, deltaY: 0.25 });
	const fractionalOffset = session.displayOffset;
	render(30);
	assert.equal(session.displayOffset, fractionalOffset, 'unchanged capacity must preserve a fractional wheel viewport');
});
