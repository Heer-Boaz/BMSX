import { create_rect_bounds } from '../../machine/ts/common/rect';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveStudioFixture } from '../helpers/live_studio';

test('Studio reallocates its own workspace, retaining documents and restoring the unchanged game presentation', async t => {
	const f = await createLiveStudioFixture(t);
	const resize = t.mock.method(f.backend, 'resizePresentationTarget');
	f.editor.deactivate();
	const game = [f.presenter.viewportSize.x, f.presenter.viewportSize.y];
	f.display.workspace.layout(1920, 1080);
	f.editor.activate();
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [640, 360]);
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	const media = f.sources.currentBlua32Media, cycles = f.runtime.machine.scheduler.nowCycles;
	f.editor.setUiScale(1.25);
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [512, 288]);
	assert.ok(f.editor.editorParts.activeGroup.model.activeTab === input);
	assert.ok(f.sources.currentBlua32Media === media);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles, 'UI scaling neither runs nor reinitializes the guest');
	const beforeHidden = resize.mock.callCount();
	f.display.workspace.layout(0, 0);
	f.display.workspace.layout(1920, 1080);
	assert.equal(resize.mock.callCount(), beforeHidden, 'hidden areas do not allocate, and restoring unchanged dimensions reuses the target');
	f.display.workspace.layout(1920, 400);
	assert.equal(f.presenter.viewportSize.x, 512, 'shorter windows do not shrink UI scale to retain a fixed row count');
	f.display.workspace.layout(1920, 1080);
	await f.frame();
	f.display.setPointerCursor('col-resize');
	f.editor.deactivate();
	assert.equal(f.display.workspace.active, false);
	assert.equal(f.display.pointerCursor, 'default');
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], game);
	f.editor.activate();
	assert.equal(f.editor.uiScale, 1.25);
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [512, 288]);
});

test('Source caret, selection and context menus keep their document meaning across workbench UI scales', async t => {
	const f = await createLiveStudioFixture(t);
	const resource = f.sources.catalog.luaResources.find(resource => resource.path === 'scenes/text.lua')!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const source = model.buffer.getText(), group = f.editor.editorParts.activeGroup;
	const input = new CodeEditorInput(model); group.openEditor(input); group.focus(); f.editor.update(0);
	const pane = group.panes.activePane!; assert.ok(pane instanceof CodeEditorPane);
	const bounds = create_rect_bounds();
	for (const scale of [0.75, 1.25, 2] as const) {
		f.editor.setUiScale(scale); await f.frame();
		const point = (column: number) => {
			resolveTextPositionBounds(pane.code, 0, column, bounds);
			return { type: 'pointer' as const, x: bounds.left + (bounds.right - bounds.left) * 0.25,
				y: (bounds.top + bounds.bottom) / 2 };
		};
		f.native.apply([point(6), { type: 'button', button: 'primary', down: true },
			point(11), { type: 'button', button: 'primary', down: false }]);
		assert.equal(input.context.view.cursorRow, 0);
		assert.equal(input.context.view.cursorColumn, 11);
		assert.deepEqual(input.context.view.selectionAnchor, { row: 0, column: 6 });
		f.editor.commands.execute('contextMenu', pane.commandTarget); f.editor.update(0);
		assert.equal(f.editor.contextMenu.visible, true);
		const popup = f.editor.contextMenu.model.viewport.bounds;
		assert.ok(popup.left >= 0 && popup.right <= f.presenter.viewportSize.x
			&& popup.top >= 0 && popup.bottom <= f.presenter.viewportSize.y, 'popup layout consumes the current work area');
		f.editor.contextMenu.hide();
		assert.ok(group.model.activeTab === input && input.workingCopy === model);
	}
	assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
});
