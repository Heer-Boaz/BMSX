import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkbenchFixedEdgeSplitView, WorkbenchSplitView } from '../../ide/workbench/ui/split_view';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

const COMMANDS = ['workspace.resizeViewWidth', 'workspace.resizeViewHeight',
	'workspace.resetViewWidth', 'workspace.resetViewHeight'] as const;

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const editor = f.editor, parts = editor.editorParts, main = editor.mainWorkspace;
	editor.updateViewport({ width: 1600, height: 800 }); editor.setFontVariant(font);
	parts.minimize(f.firstPart); parts.minimize(f.secondPart);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, inputFocus.target), true);
	const primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	const group = parts.main.activeGroup, input = new CodeEditorInput(model);
	group.openEditor(input); main.openActivity('problems'); editor.resourcePanel.show(); f.update();
	return { ...f, parts, main, primary, model, group, input };
}

for (const region of ['Files', 'Hierarchy', 'Details', 'Activity'] as const)
	for (const finish of ['Enter', 'Escape'] as const)
		test(`${region} native resize entry and ${finish} retain live sizing and return to the exact invoking client`, async t => {
			const f = await fixture(t), { editor, main } = f, files = editor.resourcePanel;
			if (region === 'Files') files.focusTarget.focus();
			else if (region === 'Activity') main.focusActivity();
			else main.focusPrimary(region === 'Hierarchy' ? 'hierarchy' : 'details');
			const origin = inputFocus.admittedTarget!, axis = region === 'Activity' ? 'height' : 'width';
			const control = region === 'Files' ? files.sash : main.resizeControlForTarget(origin, axis)!;
			const fixed = region === 'Files' ? undefined : region === 'Hierarchy' ? main.regionLayout.hierarchySash
				: region === 'Details' ? main.regionLayout.detailsSash : main.regionLayout.activitySash;
			const split = region === 'Files' ? files.split : fixed!;
			assert.ok(control.input === split);
			const source = f.model.buffer.getText(), version = f.model.version, selected = f.primary.consumer.selection;
			const tabs = [...f.group.model.tabs], topology = f.parts.main.arrangement.topologyRevision;
			const enter = axis === 'width' ? 'workspace.resizeViewWidth' : 'workspace.resizeViewHeight';
			const reset = axis === 'width' ? 'workspace.resetViewWidth' : 'workspace.resetViewHeight';
			assert.equal(editor.commands.isEnabled(enter, origin), true);
			editor.commands.execute(enter, origin); f.update();
			assert.ok(inputFocus.admittedTarget === control.focusTarget);
			assert.equal(editor.commands.isEnabled(axis === 'width' ? 'workspace.resizeViewHeight' : 'workspace.resizeViewWidth', origin), false);
			f.key(axis === 'width' ? 'ArrowRight' : 'ArrowUp');
			assert.equal(split.canReset, true);
			const ratio = files.split.ratio, requested = fixed?.requestedSize;
			f.key(finish);
			assert.ok(inputFocus.admittedTarget === origin);
			assert.equal(files.split.ratio, ratio);
			if (fixed !== undefined) assert.equal(fixed.requestedSize, requested, 'Escape is not a rollback of live sash sizing');
			assert.equal(editor.commands.isEnabled(reset, origin), true);
			editor.commands.execute(reset, origin); f.update();
			assert.equal(split.canReset, false); assert.ok(inputFocus.admittedTarget === origin);
			assert.ok(main.primary === f.primary && f.primary.consumer.selection === selected);
			assert.deepEqual(f.group.model.tabs, tabs); assert.equal(f.parts.main.arrangement.topologyRevision, topology);
			assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
		});

for (const font of ['tiny', 'msx'] as const)
	test(`${font} direct Details reset restores intrinsic sizing without accepting an invalid native field draft`, async t => {
		const f = await fixture(t, font), { editor, primary, main, model } = f;
		main.focusPrimary('details'); const field = primary.details.control.controls[0];
		assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '-', true);
		const origin = inputFocus.admittedTarget!, source = model.buffer.getText(), version = model.version;
		const selection = primary.consumer.selection, generation = primary.details.scope.contextGeneration;
		editor.commands.execute('workspace.increaseViewWidth', origin); f.update();
		assert.notEqual(main.regionLayout.detailsWidth, undefined);
		assert.equal(editor.commands.isEnabled('workspace.resetViewWidth', origin), true);
		editor.commands.execute('workspace.resetViewWidth', origin); f.update();
		assert.equal(main.regionLayout.detailsWidth, undefined); assert.equal(field.pending, true); assert.equal(field.field.text, '-');
		assert.ok(inputFocus.admittedTarget === origin && main.primary === primary && primary.consumer.selection === selection);
		assert.equal(primary.details.scope.contextGeneration, generation);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false);
	});

test('the actual Palette enters and resets its captured Files handle rather than a background document', async t => {
	const f = await fixture(t), { editor } = f, files = editor.resourcePanel;
	files.focusTarget.focus(); const origin = inputFocus.admittedTarget!, selected = files.files.selectedNode;
	const document = f.group.model.activeTab, source = f.model.buffer.getText();
	for (const command of ['workspace.resizeViewWidth', 'workspace.resetViewWidth'] as const) {
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		const picker = editor.quickInput;
		assert.equal(picker.visible, true);
		const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === command);
		assert.ok(index >= 0); picker.model.list.selectionIndex = index; f.key('Enter');
		assert.equal(picker.visible, false);
		if (command === 'workspace.resizeViewWidth') {
			assert.ok(inputFocus.admittedTarget === files.sash.focusTarget);
			f.key('ArrowRight'); assert.equal(files.split.canReset, true); f.key('Escape');
		} else assert.equal(files.split.canReset, false);
		assert.ok(inputFocus.admittedTarget === origin && files.files.selectedNode === selected);
	}
	assert.ok(f.group.model.activeTab === document); assert.equal(f.model.buffer.getText(), source);
});

for (const presentation of ['Main', 'floating'] as const)
	test(`${presentation} document handle entry/reset chooses the nearest boundary on each axis without changing topology or subject`, async t => {
		const f = await fixture(t), { editor, parts, main } = f;
		main.setRegionVisible('hierarchy', false); main.setRegionVisible('details', false); main.setActivityVisible(false); editor.resourcePanel.hide();
		const part = presentation === 'Main' ? parts.main : parts.createDocument({ requestedBounds: { left: 20, top: 40, right: 1500, bottom: 700 } });
		const group = part.activeGroup; group.openEditor(new CodeEditorInput(f.model));
		const right = part.splitGroup(group, 'right'), below = part.splitGroup(group, 'down');
		right.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); below.openEditor(new CodeEditorInput(f.secondInput.workingCopy)); f.update();
		group.panes.activePane!.focus(); const origin = inputFocus.admittedTarget!;
		const branches = [...part.arrangement.splits], topology = part.arrangement.topologyRevision;
		const groups = [...part.groups], tabs = groups.map(candidate => [...candidate.model.tabs]);
		for (const axis of ['width', 'height'] as const) {
			const branch = branches.find(candidate => candidate.split.orientation === (axis === 'width' ? 'horizontal' : 'vertical'))!;
			const other = branches.find(candidate => candidate !== branch)!, otherRatio = other.split.ratio;
			const control = part.resizeControlForGroup(group, axis)!;
			assert.ok(control.input === branch.split);
			editor.commands.execute(axis === 'width' ? 'workspace.resizeViewWidth' : 'workspace.resizeViewHeight', origin); f.update();
			assert.ok(inputFocus.admittedTarget === control.focusTarget);
			f.key(axis === 'width' ? 'ArrowRight' : 'ArrowDown'); assert.equal(branch.split.canReset, true);
			const resized = branch.split.ratio;
			f.key('Escape'); assert.ok(inputFocus.admittedTarget === origin); assert.equal(branch.split.ratio, resized);
			editor.commands.execute(axis === 'width' ? 'workspace.resetViewWidth' : 'workspace.resetViewHeight', origin); f.update();
			assert.equal(branch.split.ratio, branch.split.defaultRatio); assert.equal(other.split.ratio, otherRatio);
			assert.ok(inputFocus.admittedTarget === origin);
		}
		assert.equal(part.arrangement.topologyRevision, topology); assert.deepEqual(part.groups, groups);
		groups.forEach((candidate, index) => assert.deepEqual(candidate.model.tabs, tabs[index]));
		const input = group.panes.activePane!.input;
		assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
	});

test('a saturated Main boundary can reset its retained request without offering keyboard movement', async t => {
	const f = await fixture(t), { editor, main } = f;
	main.focusPrimary('details'); const origin = inputFocus.admittedTarget!, split = main.regionLayout.detailsSash;
	editor.commands.execute('workspace.increaseViewWidth', origin); f.update();
	editor.updateViewport({ width: 120, height: 150 }); main.focusPrimary('details'); editor.update(0);
	assert.equal(split.resizable, false); assert.equal(split.canReset, true);
	assert.equal(editor.commands.isEnabled('workspace.resizeViewWidth', origin), false);
	assert.equal(editor.commands.isEnabled('workspace.resetViewWidth', origin), true);
	editor.commands.execute('workspace.resetViewWidth', origin); editor.update(0);
	assert.equal(split.requestedSize, undefined); assert.ok(inputFocus.admittedTarget === origin);
});

test('maximized document groups never lend their retained split or Main side regions to entry/reset commands', async t => {
	const f = await fixture(t), part = f.parts.main, group = f.group;
	part.splitGroup(group, 'right'); f.update(); const split = part.arrangement.splits[0].split;
	split.ratio = 0.65; part.arrangement.toggleMaximize(group); part.relayout(); group.panes.activePane!.focus();
	const origin = inputFocus.admittedTarget!, ratio = split.ratio;
	const hierarchy = f.main.regionLayout.hierarchyWidth, details = f.main.regionLayout.detailsWidth;
	for (const command of COMMANDS) {
		assert.equal(f.editor.commands.isEnabled(command, origin), false); f.editor.commands.execute(command, origin);
	}
	assert.equal(split.ratio, ratio); assert.ok(part.arrangement.maximized === group && inputFocus.admittedTarget === origin);
	assert.equal(f.main.regionLayout.hierarchyWidth, hierarchy); assert.equal(f.main.regionLayout.detailsWidth, details);
});

for (const admission of ['hidden Activity', 'floating Activity', 'modal', 'guest'] as const)
	test(`${admission} has no sizing handle authority and never resets a background owner`, async t => {
		const f = await fixture(t), { editor, main } = f;
		f.parts.main.splitGroup(f.group, 'right'); f.update();
		const split = f.parts.main.arrangement.splits[0].split; split.ratio = 0.65;
		main.focusActivity(); let origin = inputFocus.admittedTarget!;
		if (admission === 'hidden Activity') main.setActivityVisible(false);
		else if (admission === 'floating Activity') main.setActivityPlacement('floatingWindow');
		else if (admission === 'modal') {
			const area = main.bounds;
			const modal = editor.surfaces.attach({ role: 'modal', blockedScope: main.surface, presentationParent: null,
				lifetimeOwner: main.surface, captureScope: Symbol('sizing decision'), isVisible: () => true,
				getBounds: () => area, getClip: () => area, draw() {} }); t.after(() => modal.dispose());
		} else {
			f.group.openEditor(new GameViewInput()); f.update(); f.group.panes.activePane!.focus(); f.key('Tab');
			origin = inputFocus.admittedTarget!; assert.ok(origin.guestInput !== undefined);
		}
		f.update(); const focused = inputFocus.admittedTarget, ratio = split.ratio, files = editor.resourcePanel.split.ratio;
		const height = main.regionLayout.activityHeight, width = main.regionLayout.detailsWidth, cycles = f.host.runtime.machine.scheduler.nowCycles;
		for (const command of COMMANDS) {
			assert.equal(editor.commands.isEnabled(command, origin), false); editor.commands.execute(command, origin);
		}
		assert.equal(split.ratio, ratio); assert.equal(editor.resourcePanel.split.ratio, files);
		assert.equal(main.regionLayout.activityHeight, height); assert.equal(main.regionLayout.detailsWidth, width);
		assert.ok(inputFocus.admittedTarget === focused); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('removing the exact document boundary retires its focused handle without withdrawing the surviving source', async t => {
	const f = await fixture(t), part = f.parts.main, group = f.group;
	const right = part.splitGroup(group, 'right'); f.update(); group.panes.activePane!.focus();
	const origin = inputFocus.admittedTarget!, source = f.model.buffer.getText(), input = group.model.activeTab;
	f.editor.commands.execute('workspace.resizeViewWidth', origin); f.update();
	const handle = inputFocus.admittedTarget!; assert.ok(handle !== origin);
	f.key('ArrowRight'); const split = part.arrangement.splits[0].split, resized = split.ratio;
	assert.equal(part.removeGroup(right), true); f.update();
	assert.ok(inputFocus.admittedTarget !== handle); f.key('Escape');
	assert.equal(split.ratio, resized); assert.ok(group.model.activeTab === input && !part.retired);
	assert.equal(f.model.buffer.getText(), source);
});

for (const region of ['Files', 'Hierarchy', 'Details', 'Activity', 'Main group', 'floating group'] as const)
	test(`${region} Palette cancellation cannot restore a retired keyboard-resize session or trap subsequent arrows`, async t => {
		const f = await fixture(t), { editor, main, parts } = f, files = editor.resourcePanel;
		let part = parts.main, group = f.group;
		const document = region === 'Main group' || region === 'floating group', axis = region === 'Activity' ? 'height' : 'width';
		if (document) {
			if (region === 'floating group') part = parts.createDocument({ requestedBounds: { left: 20, top: 40, right: 1500, bottom: 700 } });
			group = part.activeGroup; group.openEditor(new CodeEditorInput(f.model)); part.splitGroup(group, 'right');
			f.update(); group.panes.activePane!.focus();
		} else if (region === 'Files') files.focusTarget.focus();
		else if (region === 'Activity') main.focusActivity();
		else main.focusPrimary(region === 'Hierarchy' ? 'hierarchy' : 'details');
		const origin = inputFocus.admittedTarget!, control = document ? part.resizeControlForGroup(group, axis)!
			: region === 'Files' ? files.sash : main.resizeControlForTarget(origin, axis)!;
		const native = control.input!;
		assert.ok(native instanceof WorkbenchSplitView || native instanceof WorkbenchFixedEdgeSplitView);
		const source = f.model.buffer.getText(), version = f.model.version, input = group.model.activeTab;
		const enter = axis === 'width' ? 'workspace.resizeViewWidth' : 'workspace.resizeViewHeight';
		editor.commands.execute(enter, origin); f.update();
		assert.ok(inputFocus.admittedTarget === control.focusTarget); assert.equal(control.interactionActive, true);
		f.key(axis === 'width' ? 'ArrowRight' : 'ArrowUp');
		// This is the actual sizing owner's retained preference, not rendered geometry.
		const intent = native instanceof WorkbenchSplitView ? native.ratio : native.requestedSize;
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		assert.equal(editor.quickInput.visible, true); assert.equal(control.interactionActive, false);
		assert.ok(inputFocus.admittedTarget === editor.quickInput.field.focusTarget);
		f.key('Escape');
		assert.equal(editor.quickInput.visible, false); assert.equal(control.interactionActive, false);
		assert.ok(inputFocus.admittedTarget === origin, 'a canceled handle is not an admissible popup return control');
		f.key(axis === 'width' ? 'ArrowRight' : 'ArrowUp');
		assert.equal(native instanceof WorkbenchSplitView ? native.ratio : native.requestedSize, intent,
			'ordinary client arrows cannot resume the retired sizing session');
		assert.ok(inputFocus.admittedTarget !== control.focusTarget);
		origin.focus(); editor.commands.execute(enter, origin); f.update();
		assert.ok(inputFocus.admittedTarget === control.focusTarget); assert.equal(control.interactionActive, true);
		f.key('Enter'); assert.ok(inputFocus.admittedTarget === origin);
		assert.equal(native instanceof WorkbenchSplitView ? native.ratio : native.requestedSize, intent);
		assert.ok(group.model.activeTab === input); assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version);
	});
