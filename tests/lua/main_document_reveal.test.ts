import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

const SCENE = `local scenes = require('cartlib/world/scene_library')
scenes.register('retained', { objects = {
 { member_id = 'selected', definition_id = 'example', options = { pos = { x = 1, y = 2, z = 3 } } },
} })
return {}
`;

for (const font of ['tiny', 'msx'] as const) for (const direction of ['right', 'down'] as const)
	test(`Main ${font} ${direction} arrangement reveals the requested concrete document leaf through outer overflow`, async t => {
		const f = createActualSourcePanes(t, false, [['scene.lua', SCENE], ['cartlib/world/scene_library.lua', 'return {}'], ['third.lua', 'return 3\n']]);
		const editor = f.editor, main = editor.mainWorkspace, part = editor.editorParts.main;
		const sceneResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, sceneResource), document = f.ide.sceneSources.get(model);
		assert.equal(await editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
		main.focusActivity();
		editor.updateViewport(direction === 'right' ? { width: 200, height: 320 } : { width: 300, height: 120 });
		editor.setFontVariant(font); f.update();
		const first = part.activeGroup; first.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
		const second = part.splitGroup(first, direction); second.openEditor(new CodeEditorInput(f.secondInput.workingCopy));
		const third = part.splitGroup(second, direction);
		const thirdResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!;
		third.openEditor(new CodeEditorInput(resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, thirdResource))); f.update();
		const primary = main.primary, execution = f.host.execution.revision;
		assert.ok(primary?.hierarchy.attached && primary.details.attached && editor.problems.attached);
		for (const group of [first, second, third, second, first]) {
			assert.equal(group.focus(), true); f.update();
			assert.ok(inputFocus.admittedTarget === group.panes.activePane?.commandTarget);
			assert.ok(part.activeGroup === group);
			const bounds = group.panes.contentBounds;
			// The real native hit must reach the focused leaf, rather than a clipped sibling or empty canvas.
			// Geometry operates that target; no pixel allocation or minimum is frozen here.
			const hit = editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
			assert.ok(hit === group.paneSurface);
		}
		assert.equal(third.focus(), true); f.update();
		editor.commands.execute('group.openEditors', third.tabFocusTarget); f.update();
		const picker = part.quickInput; assert.equal(picker.visible, true);
		const field = picker.layout.field;
		assert.equal(editor.surfaces.hitTest((field.left + field.right) / 2, (field.top + field.bottom) / 2)?.captureScope, picker.pointerScope);
		f.key('Escape'); assert.equal(picker.visible, false);
		const prompt = part.actionPrompt;
		const decision = prompt.show({ title: 'Unsaved', message: 'Choose the source action.', primary: 'Save', secondary: 'Discard',
			primaryEnabled: true, defaultChoice: 'primary' }); f.update();
		for (const button of prompt.view.buttons) {
			const bounds = button.bounds;
			assert.equal(editor.surfaces.hitTest((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2)?.captureScope, prompt.pointerScope);
		}
		const cancel = prompt.view.buttons.find(button => button.choice === 'cancel')!.bounds;
		for (const down of [true, false]) editor.dispatchPointer({ x: (cancel.left + cancel.right) / 2, y: (cancel.top + cancel.bottom) / 2,
			buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
			releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		assert.equal(await decision, 'cancel'); assert.equal(prompt.visible, false);
		f.second.focus(); f.update(); const foreground = inputFocus.admittedTarget;
		assert.ok(foreground === f.second.code.focusTarget && editor.editorParts.activePart === f.secondPart);
		assert.equal(part.revealGroup(first), true); f.update();
		assert.ok(inputFocus.admittedTarget === foreground && editor.editorParts.activePart === f.secondPart,
			'background placement reveals its concrete leaf without raising or activating Main');
		assert.ok(main.primary === primary && primary.hierarchy.attached && primary.details.attached && editor.problems.attached);
		assert.equal(model.dirty, false); assert.equal(f.host.execution.revision, execution);
	});
