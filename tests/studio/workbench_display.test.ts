import { fontEmSize } from '../../machine/ts/render/shared/bmsx_font';
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
import { editorViewState } from '../../ide/editor/ui/view/state';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';

test('constrained workspace allocation settles without republishing unchanged surface geometry', async t => {
	const f = await createLiveStudioFixture(t);
	const part = f.editor.editorParts.main, input = part.activeGroup.model.activeTab;
	for (const font of ['tiny', 'msx', 'mono'] as const) {
		f.editor.preferences.fontVariant = font;
		part.prepareLayout();
		const width = part.minimumClientWidth, height = part.minimumClientHeight;
		const constrained = Math.max(1, Math.trunc(height * 3 / 2));
		for (const availableHeight of [constrained, 1080, constrained]) {
			f.display.workspace.layout(1152, availableHeight, 1);
			f.editor.update(0);
			const layout = f.editor.mainWorkspace.regionLayout;
			assert.equal(layout.contentHeight > layout.bounds.bottom - layout.bounds.top, availableHeight === constrained,
				'the parent admits and retires vertical overflow without changing the child minimum');
			assert.equal(part.minimumClientWidth, width); assert.equal(part.minimumClientHeight, height);
			const revision = f.editor.surfaces.revision;
			for (let tick = 0; tick < 5; tick++) f.editor.update(0);
			assert.equal(f.editor.surfaces.revision, revision, 'idle updates do not invalidate hit testing and hover for an unchanged allocation');
			assert.ok(part.activeGroup.model.activeTab === input);
		}
	}
});

test('project recovery cannot replace frontend typography with its old saved font', async t => {
	const f = await createLiveStudioFixture(t);
	const legacyRecovery = {
		dirtyFiles: [], mainWorkspace: f.editor.mainWorkspace.serialize(),
		editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers), sceneCompanion: undefined,
		filesBrowser: f.editor.resourcePanel.serialize(), breakpoints: [], fontVariant: 'tiny',
	};
	const defaultFont = editorViewState.font;
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, legacyRecovery);
	assert.equal(f.editor.fontVariant, 'mono'); assert.equal(f.editor.preferences.fontVariant, 'mono');
	assert.ok(editorViewState.font === defaultFont, 'source recovery does not even recreate font metrics');
	f.editor.preferences.fontVariant = 'msx';
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, legacyRecovery);
	assert.equal(f.editor.fontVariant, 'msx', 'explicit frontend preferences also survive project recovery');
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

test('font smoothing uses the preference owner and retains the document, metrics and raster allocation', async t => {
	const f = await createLiveStudioFixture(t);
	assert.equal(f.editor.fontVariant, 'mono', 'new workspaces use the scalable font');
	f.editor.preferences.fontVariant = 'tiny';
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	const viewport = { ...f.presenter.viewportSize }, raster = f.backend.borrowPresentedPixels().buffer;
	const before = editorViewState.font;
	assert.equal(f.editor.preferences.fontSampling === 'linear', true);
	f.editor.preferences.fontSampling = f.editor.preferences.fontSampling === 'linear' ? 'nearest' : 'linear';
	assert.equal(f.editor.preferences.fontSampling === 'linear', false);
	const after = editorViewState.font;
	assert.equal(after.renderFont().sampling, 'nearest');
	assert.equal(after.renderFont('italic').sampling, 'nearest');
	assert.equal(after.lineHeight, before.lineHeight);
	assert.equal(after.measure('True\tfalse'), before.measure('True\tfalse'));
	assert.ok(f.editor.editorParts.activeGroup.model.activeTab === input);
	await f.frame();
	assert.ok(f.backend.borrowPresentedPixels().buffer === raster);
	assert.deepEqual(f.presenter.viewportSize, viewport);
	f.editor.preferences.fontVariant = 'msx';
	assert.equal(editorViewState.font.renderFont().sampling, 'nearest');
	f.editor.preferences.fontSampling = f.editor.preferences.fontSampling === 'linear' ? 'nearest' : 'linear';
	assert.equal(editorViewState.font.renderFont().sampling, 'linear');
	f.editor.preferences.fontVariant = 'mono';
	assert.equal(editorViewState.font.renderFont().raster, 'msdf');
	assert.ok(f.editor.editorParts.activeGroup.model.activeTab === input);
	assert.ok(f.backend.borrowPresentedPixels().buffer === raster);
});

test('Pixel font size publishes one shared font generation without changing source or game raster', async t => {
	const f = await createLiveStudioFixture(t), editor = f.editor;
	const input = editor.editorParts.activeGroup.model.activeTab;
	editor.resourcePanel.show(); editor.update(0);
	const viewport = { ...f.presenter.viewportSize }, raster = f.backend.borrowPresentedPixels().buffer;
	const media = f.sources.currentBlua32Media, cycles = f.runtime.machine.scheduler.nowCycles;
	const font = editorViewState.font, files = editor.resourcePanel, rows = files.files.tree.rows, selected = files.files.selectedNode;
	assert.equal(editor.preferences.fontSize, 14);
	editor.preferences.fontSize = 14; f.display.workspace.refresh();
	assert.ok(editorViewState.font === font, 'unchanged size and allocation retain the font generation');
	editor.preferences.fontSize = 12;
	const next = editorViewState.font;
	assert.equal(next.scale * fontEmSize('mono') * 3, 12);
	assert.ok(Math.abs(next.measure('Column\tname') / font.measure('Column\tname') - 12 / 14) < 1e-10);
	assert.equal(next.renderFont('italic').lineHeight, next.lineHeight);
	assert.ok(next.renderFont().atlas === font.renderFont().atlas);
	assert.ok(files.files.tree.rows === rows); assert.ok(files.files.selectedNode === selected);
	assert.ok(editor.editorParts.activeGroup.model.activeTab === input); assert.ok(f.sources.currentBlua32Media === media);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles);
	assert.deepEqual(f.presenter.viewportSize, viewport);
	await f.frame(); assert.ok(f.backend.borrowPresentedPixels().buffer === raster);
	editor.preferences.fontVariant = 'tiny'; assert.equal(editorViewState.font.scale * fontEmSize('tiny') * 3, 12);
	editor.preferences.fontVariant = 'mono'; assert.equal(editorViewState.font.scale * fontEmSize('mono') * 3, 12);
});

test('Studio reallocates its own workspace, retaining documents and restoring the unchanged game presentation', async t => {
	const f = await createLiveStudioFixture(t);
	const resize = t.mock.method(f.backend, 'resizePresentationTarget');
	f.editor.deactivate();
	const game = [f.presenter.viewportSize.x, f.presenter.viewportSize.y];
	f.display.workspace.layout(1920, 1080, 1);
	f.editor.activate();
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [640, 360]);
	await f.frame();
	assert.deepEqual(f.presenter.canvasSize, { x: 1920, y: 1080 });
	const raster = f.backend.borrowPresentedPixels().buffer, allocations = resize.mock.callCount();
	const input = f.editor.editorParts.activeGroup.model.activeTab;
	const media = f.sources.currentBlua32Media, cycles = f.runtime.machine.scheduler.nowCycles;
	f.editor.preferences.fontSize = 16;
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [640, 360]);
	assert.ok(f.editor.editorParts.activeGroup.model.activeTab === input);
	assert.ok(f.sources.currentBlua32Media === media);
	assert.equal(f.runtime.machine.scheduler.nowCycles, cycles, 'Font sizing neither runs nor reinitializes the guest');
	await f.frame();
	assert.equal(resize.mock.callCount(), allocations, 'Font sizing changes control layout, not the backing buffer');
	assert.ok(f.backend.borrowPresentedPixels().buffer === raster);
	f.display.workspace.layout(1920, 1080, 1.25);
	await f.frame();
	assert.deepEqual(f.presenter.canvasSize, { x: 2400, y: 1350 });
	assert.deepEqual(f.presenter.viewportSize, { x: 640, y: 360 }, 'DPR changes density, not layout');
	const beforeHidden = resize.mock.callCount();
	f.display.workspace.layout(0, 0, 1);
	f.display.workspace.layout(1920, 1080, 1.25);
	assert.equal(resize.mock.callCount(), beforeHidden, 'hidden areas do not allocate, and restoring unchanged dimensions reuses the target');
	f.display.workspace.layout(1920, 400, 1);
	assert.equal(f.presenter.viewportSize.x, 640, 'shorter windows do not shrink UI scale to retain a fixed row count');
	f.display.workspace.layout(1920, 1080, 1);
	await f.frame();
	f.display.setPointerCursor('col-resize');
	f.editor.deactivate();
	assert.equal(f.display.workspace.active, false);
	assert.equal(f.display.pointerCursor, 'default');
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], game);
	f.editor.activate();
	assert.equal(f.editor.preferences.fontSize, 16);
	assert.deepEqual([f.presenter.viewportSize.x, f.presenter.viewportSize.y], [640, 360]);
});

test('Source caret, selection and context menus keep their document meaning across font sizes', async t => {
	const f = await createLiveStudioFixture(t);
	const resource = f.sources.catalog.luaResources.find(resource => resource.path === 'scenes/text.lua')!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const source = model.buffer.getText(), group = f.editor.editorParts.activeGroup;
	const input = new CodeEditorInput(model); group.openEditor(input); group.focus(); f.editor.update(0);
	const pane = group.panes.activePane!; assert.ok(pane instanceof CodeEditorPane);
	const bounds = create_rect_bounds();
	for (const size of [12, 16, 24] as const) {
		f.editor.preferences.fontSize = size; await f.frame();
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
	const width = geometry.viewportWidth, height = geometry.viewportHeight;
	const pixelWidth = geometry.targetWidth, pixelHeight = geometry.targetHeight;
	geometry.update(0, 0, width, height, pixelWidth, pixelHeight, width, height);
	f.display.workspace.refresh();
	assert.equal(pointerCapture.active, true, 'unchanged publication cannot interrupt a live gesture');
	const column = input.context.view.cursorColumn, anchor = { ...input.context.view.selectionAnchor! }, source = model.buffer.getText();
	if (change === 'display translation') geometry.update(40, 25, width, height, pixelWidth, pixelHeight, width, height);
	else f.display.workspace.layout(1920, 1080, 1);
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
