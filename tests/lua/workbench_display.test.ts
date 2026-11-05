import { create_rect_bounds } from '../../machine/ts/common/rect';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { drawIde } from '../../ide/workbench/mode';

test('constrained workspace allocation settles without republishing unchanged surface geometry', async t => {
	const f = await createLiveStudioFixture(t);
	const part = f.editor.editorParts.main, input = part.activeGroup.model.activeTab;
	for (const font of ['tiny', 'msx'] as const) {
		f.editor.setFontVariant(font);
		part.prepareLayout();
		const width = part.minimumClientWidth, height = part.minimumClientHeight;
		for (const availableHeight of [120, 1080, 120]) {
			f.display.workspace.layout(1152, availableHeight);
			f.editor.update(0);
			const layout = f.editor.mainWorkspace.regionLayout;
			assert.equal(layout.contentHeight > layout.bounds.bottom - layout.bounds.top, availableHeight === 120,
				'the parent admits and retires vertical overflow without changing the child minimum');
			assert.equal(part.minimumClientWidth, width); assert.equal(part.minimumClientHeight, height);
			const revision = f.editor.surfaces.revision;
			for (let tick = 0; tick < 5; tick++) f.editor.update(0);
			assert.equal(f.editor.surfaces.revision, revision, 'idle updates do not invalidate hit testing and hover for an unchanged allocation');
			assert.ok(part.activeGroup.model.activeTab === input);
		}
	}
});

test('workbench layout publishes its viewport to the drawing owner without rereading the presenter', async t => {
	const f = await createLiveStudioFixture(t);
	const target = { ...f.presenter.viewportSize };
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	f.editor.updateViewport({ width: 400, height: 300 });
	drawIde(f.ide);
	const frame = f.presenter.hostOverlayQueue.consumeOverlayFrame();
	assert.deepEqual([frame.logicalWidth, frame.logicalHeight], [400, 300]);
	assert.deepEqual(f.presenter.viewportSize, target, 'logical workbench layout does not select a different presentation target');
	assert.ok(f.editor.editorParts.activeGroup.model.activeTab === input);
});

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
	f.editor.preferences.uiScale = 1.25;
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
	assert.equal(f.editor.preferences.uiScale, 1.25);
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
		f.editor.preferences.uiScale = scale; await f.frame();
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

for (const change of ['display translation', 'workspace allocation']) test(`a ${change} retires the old coordinate-frame gesture without changing source, selection or focus`, async t => {
	const f = await createLiveStudioFixture(t), group = f.editor.editorParts.activeGroup;
	const resource = f.sources.catalog.luaResources.find(resource => resource.path === 'scenes/text.lua')!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const input = new CodeEditorInput(model); group.openEditor(input); group.focus(); f.editor.update(0);
	const pane = group.panes.activePane!; assert.ok(pane instanceof CodeEditorPane);
	const bounds = create_rect_bounds(), geometry = f.display.geometry;
	const pointer = (column: number) => {
		resolveTextPositionBounds(pane.code, 0, column, bounds);
		return { type: 'pointer' as const, x: geometry.bounds.left + bounds.left + (bounds.right - bounds.left) * 0.25,
			y: geometry.bounds.top + (bounds.top + bounds.bottom) / 2 };
	};
	f.native.apply([pointer(6), { type: 'button', button: 'primary', down: true }]);
	assert.equal(pointerCapture.active, true);
	const width = geometry.targetWidth, height = geometry.targetHeight;
	geometry.update(0, 0, width, height, width, height);
	f.display.workspace.refresh();
	assert.equal(pointerCapture.active, true, 'unchanged publication cannot interrupt a live gesture');
	const column = input.context.view.cursorColumn, anchor = { ...input.context.view.selectionAnchor! }, source = model.buffer.getText();
	if (change === 'display translation') geometry.update(40, 25, width, height, width, height);
	else f.display.workspace.layout(1920, 1080);
	assert.equal(pointerCapture.active, false);
	f.native.apply([pointer(11), { type: 'button', button: 'primary', down: false }]);
	assert.equal(pointerCapture.draining, false);
	assert.equal(input.context.view.cursorColumn, column); assert.deepEqual(input.context.view.selectionAnchor, anchor);
	assert.equal(pane.commandTarget.hasFocus, true); assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
	await f.frame();
	// A different start location begins a drag rather than a double-click on the original word.
	f.native.apply([pointer(1), { type: 'button', button: 'primary', down: true }, pointer(11), { type: 'button', button: 'primary', down: false }]);
	assert.equal(input.context.view.cursorColumn, 11);
	assert.deepEqual(input.context.view.selectionAnchor, { row: 0, column: 1 });
});
