import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createTestEditorParts } from '../helpers/editor_panes';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

test('Main document activation raises its complete presentation family, including the retained Game companion', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, main = parts.main;
	main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.editor.gamePanel.toggle(); main.focus(); f.update();
	assert.equal(f.editor.gamePanel.visible, true);
	const companion = parts.mainArea.companionBounds;
	const x = (companion.left + companion.right) / 2, y = (companion.top + companion.bottom) / 2;
	const gameSurface = f.editor.surfaces.hitTest(x, y)!;
	assert.ok(gameSurface !== main.surface && gameSurface !== main.clientSurface);
	assert.equal(gameSurface.presentationParent, main.surface);
	assert.equal(main.clientSurface.presentationParent, main.surface);
	assert.equal(main.surface.presentationParent, f.editor.mainWorkspace.surface);
	assert.equal(f.editor.surfaces.windowContext(gameSurface), f.editor.mainWorkspace.surface);
	const order: string[] = [];
	t.mock.method(main.activeGroup.panes.activePane!, 'draw', () => { order.push('main document'); });
	t.mock.method(f.editor.gamePanel, 'draw', () => { order.push('Game'); });
	t.mock.method(f.second, 'draw', () => { order.push('floating document'); });
	f.secondPart.focus(); f.update(); f.paint();
	assert.ok(order.indexOf('Game') < order.indexOf('floating document'));
	assert.equal(f.editor.surfaces.hitTest(x, y), f.secondGroup.paneSurface);
	order.length = 0;
	main.activeGroup.focus(); f.update(); f.paint();
	assert.ok(order.indexOf('floating document') < order.indexOf('main document'));
	assert.ok(order.indexOf('floating document') < order.indexOf('Game'));
	assert.equal(f.editor.surfaces.hitTest(x, y), gameSurface);
	assert.equal(f.secondGroup.model.activeTab, f.secondInput);
	assert.equal(f.secondGroup.panes.activePane, f.second);
	assert.equal(main.surface.retired, false);
	assert.equal(gameSurface.retired, false);
});

test('the nested Game surface owns guest input and shares its actual document-part modal admission', t => {
	const f = createActualSourcePanes(t), main = f.editor.editorParts.main;
	main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	f.editor.gamePanel.toggle(); main.focus(); f.update();
	const companion = f.editor.editorParts.mainArea.companionBounds;
	const x = (companion.left + companion.right) / 2, y = (companion.top + companion.bottom) / 2;
	const surface = f.editor.surfaces.hitTest(x, y)!;
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	const game = inputFocus.admittedTarget!;
	assert.equal(game.guestInput!.recipient, f.host.input);
	assert.equal(game.scope.surfaceScope, surface.captureScope);
	assert.equal(f.editor.surfaces.findByScope(game.scope.surfaceScope), surface);
	main.quickInput.input('', '', '', async value => value, () => {}); f.update();
	assert.equal(f.editor.surfaces.isAdmitted(surface), false);
	assert.equal(f.editor.surfaces.hitTest(x, y)!.captureScope, main.quickInput.pointerScope);
	main.quickInput.hide(); f.update();
	assert.equal(f.editor.surfaces.isAdmitted(surface), true);
	assert.equal(f.editor.surfaces.hitTest(x, y), surface);
});

test('retiring the document arrangement does not retire its owning Main family or sibling presentations', t => {
	const parts = createTestEditorParts(t), family = parts.main.surface.presentationParent!;
	assert.notEqual(parts.main.surface, family);
	assert.notEqual(parts.main.clientSurface, parts.main.surface);
	const main = parts.main, floating = parts.createDocument();
	main.dispose();
	assert.equal(main.surface.retired, true);
	assert.equal(main.clientSurface.retired, true);
	assert.equal(family.retired, false);
	assert.equal(floating.surface.retired, false);
});

for (const redirected of [false, true]) test(`primary recovery retirement ${redirected ? 'preserves a new blur focus request' : 'does not activate the departing control return route'}`, async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	const main = f.editor.mainWorkspace, primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	main.focusPrimary('hierarchy');
	assert.ok(inputFocus.target === primary.hierarchy.control.focusTarget);
	if (redirected) t.after(primary.hierarchy.control.focusTarget.onDidBlur(() => f.second.focus()));
	const interaction = inputFocus.interactionRevision, request = main.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true);
	request.retire();
	assert.ok(main.primary === undefined);
	if (redirected) {
		assert.ok(inputFocus.target === f.second.commandTarget);
		assert.ok(inputFocus.interactionRevision > interaction);
	} else {
		assert.ok(inputFocus.target === null);
		assert.equal(inputFocus.interactionRevision, interaction);
	}
});

for (const captured of [false, true]) test(`departing primary retirement preserves a successor region gesture admitted by its context callback (captured: ${captured})`, async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	f.update();
	const main = f.editor.mainWorkspace, previous = main.primary; assert.ok(previous instanceof ScenePrimaryClient);
	let opening: Promise<boolean> | undefined, successor: ScenePrimaryClient | undefined, cancellations = 0;
	const unbind = previous.scope.onDidRetireContext(() => {
		unbind();
		opening = f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target);
		const current = main.primary; assert.ok(current instanceof ScenePrimaryClient && current !== previous); successor = current;
		pointerCapture.beginRoute(current.hierarchy.scope.surfaceScope, { valid: true, insideViewport: true, viewportX: 10, viewportY: 100,
			pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
		if (captured) pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancellations++; } });
	});
	t.after(unbind);
	const request = main.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true); request.retire();
	assert.equal(await opening, true);
	assert.ok(successor !== undefined && main.primary === successor);
	assert.equal(cancellations, 0, 'retiring the old region cannot cancel the successor attachment gesture');
	assert.equal(pointerCapture.active, captured);
	assert.equal(pointerCapture.routeScope, successor.hierarchy.scope.surfaceScope);
});

test('retiring a primary drains its uncaptured physical region hold before another presentation can receive its release', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	f.update();
	const main = f.editor.mainWorkspace, primary = main.primary; assert.ok(primary instanceof ScenePrimaryClient);
	pointerCapture.beginRoute(primary.hierarchy.scope.surfaceScope, { valid: true, insideViewport: true, viewportX: 10, viewportY: 100,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(pointerCapture.active, false);
	assert.equal(pointerCapture.routeScope, primary.hierarchy.scope.surfaceScope);
	const request = main.beginRestore(); t.after(() => request.dispose());
	assert.equal(request.prepare(), true); request.retire();
	assert.equal(pointerCapture.routeScope, undefined);
	assert.equal(pointerCapture.draining, true);
});
