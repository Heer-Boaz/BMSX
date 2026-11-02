import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { type TestContext } from 'node:test';
import { parseCartridgePackage, parseSystemRomImage } from '../../machine/ts/rompack/image';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { buildCartridgeToolingLayer, buildSystemToolingLayer } from '../../toolchain/ts/rompack/loader';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { ScenePreviewService } from '../../ide/workbench/contrib/scene_editor/preview';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { createLoadedTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { TranslateHandle } from '../../ide/workbench/contrib/scene_editor/viewport/translate_gizmo';

// Like the native Studio suites, assets come from the explicitly built testcart.
// Current authored Lua is captured through the normal shared working-copy build.
async function openPreview(t: TestContext) {
	await openWorkspaceRecords(new MemoryWorkspaceFiles()); t.after(closeWorkspaceRecords);
	const [bios, cart] = await Promise.all([readFile('dist/system/bmsx-bios.debug.rom'), readFile('dist/studio_test.debug.rom')]);
	const sources = createLoadedTestRuntimeSourceState(await buildSystemToolingLayer(parseSystemRomImage(bios)),
		[await buildCartridgeToolingLayer(parseCartridgePackage(cart)), null]);
	const models = new EditorTextModelService(), documents = new SceneSourceDocuments(models, sources.catalog);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scenes/text.lua' })!;
	const model = resolveLuaTextFileModel(models, sources.catalog, resource), source = await readFile('carts/studio_test/scenes/text.lua', 'utf8');
	model.pushEditOperations([{offset: 0, deleteLength: model.buffer.length, text: source}]);
	const document = documents.get(model), scene = document.scenes.find(scene => stringLiteralValue(scene.id) === 'studio_test.initialized_text')!;
	assert.ok(scene);
	const authoring = new SceneAuthoringContext(model, documents, { document, scene, sourceVersion: model.version });
	const service = new ScenePreviewService(models, sources, new Map(), PSX_MACHINE_SPEC);
	const viewport = new SceneViewportViewState(authoring, sources.catalog); viewport.connectPreview(service);
	const view = viewport.runtime!;
	t.after(async () => { viewport.dispose(); await service.dispose(); authoring.dispose(); models.clear(); resetSemanticProjects(models); sources.catalog.dispose(); });
	return { sources, models, documents, model, source, document, scene, authoring, service, view, viewport };
}

function pointer(x: number, y: number, buttons: number, justPressed = 0, justReleased = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: buttons, justPressedButtons: justPressed, justReleasedButtons: justReleased,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

test('real Scene preview constructs initialized text and seeks presentation without moving its authored anchor', async t => {
	const { view, viewport, model, source, authoring, scene } = await openPreview(t);
	configureFontVariant('tiny');
	const bounds = { left: 0, top: 0, right: 512, bottom: 384 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const scope = new InputFocusScope(Symbol('runtime preview'), inputFocus.workbenchScope), target = inputFocus.createTarget(null, scope);
	target.commandContext = target;
	const control = new SceneViewportControl({ isEnabled: () => false, execute() {} }, menu, scope, target, new WorkbenchMenu([], undefined));
	t.after(() => { control.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	control.setView(viewport, bounds);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	const preview = view.session!;
	assert.equal(preview.origin, 'constructed-plan');
	assert.equal(preview.timelines.length, 1);
	assert.ok(preview.frame.bitmap);
	assert.equal(preview.geometry.visuals.length, 1);
	const initial = { ...preview.geometry.visuals[0] };
	const firstImage = new Uint8Array(preview.frame.bitmap.image.pixels);
	// Pick a genuinely drawn glyph pixel, not merely the text layout envelope.
	const image = preview.frame.bitmap.image;
	let ink = -1;
	for (let pixel = 0; pixel < image.width * image.height; pixel++) {
		if (firstImage[pixel * 4] !== firstImage[0] || firstImage[pixel * 4 + 1] !== firstImage[1] || firstImage[pixel * 4 + 2] !== firstImage[2]) { ink = pixel; break; }
	}
	assert.notEqual(ink, -1, 'construction-time text reached completed scanout');
	const inkX = ink % image.width, inkY = (ink - inkX) / image.width;
	assert.equal(preview.geometry.pick(inkX, inkY), 1);
	view.selectTimeline(preview.timelines[0]); await view.update();
	control.update();
	const slider = viewport.timelineSlider, sliderX = slider.bounds.left + 3 + (slider.bounds.right - slider.bounds.left - 6) * 0.75;
	control.handlePointer(pointer(sliderX, (slider.bounds.top + slider.bounds.bottom) / 2, 0, PointerButton.Primary, PointerButton.Primary), true);
	await view.update(); assert.equal(view.state, 'ready', view.error); assert.equal(view.time, 750);
	assert.equal(pointerCapture.active, false);
	assert.equal(preview.geometry.visuals[0].ox - initial.ox, 64);
	assert.equal(preview.geometry.visuals[0].oy, initial.oy);
	assert.notDeepEqual(preview.frame.bitmap.image.pixels, firstImage);
	assert.equal(model.buffer.getText(), source);
	const secondImage = new Uint8Array(preview.frame.bitmap.image.pixels);
	// Pick the rendered presentation, but give the canonical editor its authored
	// occurrence. The controller/timeline is deliberately not an edit target.
	const hit = preview.geometry.pick(inkX + 64, inkY)! - 1;
	assert.equal(hit, 0);
	control.update();
	const clickX = bounds.right / 2 + viewport.camera.projectX(inkX + 64, inkY, 0);
	const clickY = bounds.bottom / 2 + viewport.camera.projectY(inkX + 64, inkY, 0);
	control.handlePointer(pointer(clickX, clickY, 0, PointerButton.Primary, PointerButton.Primary), true);
	assert.ok(authoring.selection?.kind === 'member'); assert.equal(authoring.selection.entry, scene.objects[hit]);
	const { x, y } = viewport.gizmo, scale = viewport.camera.scale;
	assert.equal(viewport.gizmo.hit(x, y), TranslateHandle.View);
	control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch(pointer(x + 5 * scale, y + 3 * scale, PointerButton.Primary), false, 0, scope.surfaceScope);
	assert.equal(model.buffer.getText(), source, 'drag staging has not rewritten controller or source');
	pointerCapture.dispatch(pointer(x + 5 * scale, y + 3 * scale, 0, 0, PointerButton.Primary), false, 0, scope.surfaceScope);
	assert.equal(pointerCapture.active, false);
	assert.equal(view.session, undefined, 'old pixels and picks retire at source admission');
	assert.equal(model.buffer.getText(), source.replace('x = 16, y = 120', 'x = 21, y = 123'));
	await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.equal(view.time, 750); assert.ok(view.selectedTimeline);
	assert.equal(view.session!.geometry.visuals[0].ox, initial.ox + 64 + 5);
	assert.equal(view.session!.geometry.visuals[0].oy, initial.oy + 3);
	view.seek(0); await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.equal(view.session!.geometry.visuals[0].ox, initial.ox + 5);
	assert.equal(view.session!.geometry.visuals[0].oy, initial.oy + 3);
	model.undo(); await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.equal(model.buffer.getText(), source);
	assert.deepEqual(view.session!.frame.bitmap!.image.pixels, firstImage);
	view.seek(750); await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.deepEqual(view.session!.frame.bitmap!.image.pixels, secondImage);
});

test('independent Scene previews retire cancelled builds and seeks without touching another document', async t => {
	const { view, model, document, documents, service } = await openPreview(t);
	const scene = document.scenes.find(scene => stringLiteralValue(scene.id) === 'studio_test.text')!;
	const otherAuthoring = new SceneAuthoringContext(model, documents, { document, scene, sourceVersion: model.version });
	t.after(() => otherAuthoring.dispose());
	const other = service.create(otherAuthoring);
	const cancelledBuild = view.start(); view.stop(); await cancelledBuild;
	assert.equal(view.state, 'stopped'); assert.equal(view.session, undefined);
	await Promise.all([view.start(), other.start()]);
	assert.equal(view.state, 'ready', view.error); assert.equal(other.state, 'ready', other.error);
	assert.notEqual(view.session!.execution.runtime, other.session!.execution.runtime);
	assert.equal(view.session!.geometry.visuals.length, 1); assert.equal(other.session!.geometry.visuals.length, 2);
	const retained = other.session!, pixels = new Uint8Array(retained.frame.bitmap!.image.pixels);
	view.selectTimeline(view.session!.timelines[0]); await view.update();
	const retiring = view.session!;
	view.seek(750); const cancelledSeek = view.update(); view.stop(); await cancelledSeek;
	assert.equal(view.state, 'stopped'); assert.equal(view.session, undefined);
	assert.equal(retiring.frame.bitmap, undefined); assert.equal(retiring.geometry.visuals.length, 0);
	assert.equal(other.session, retained); assert.deepEqual(retained.frame.bitmap!.image.pixels, pixels);
	const closingBuild = view.start();
	await service.dispose(); await closingBuild;
	assert.equal(view.session, undefined); assert.equal(other.session, undefined);
	assert.equal(retained.frame.bitmap, undefined);
});

test('an authored edit supersedes an in-flight Scene build before it can publish pixels or picks', async t => {
	const { view, viewport, model, source } = await openPreview(t);
	const obsolete = view.start();
	assert.equal(viewport.canFrameAll, false); assert.equal(viewport.frame(undefined), false);
	const offset = source.indexOf('x = 16, y = 120') + 4;
	model.pushEditOperations([{ offset, deleteLength: 2, text: '21' }]);
	const replacement = view.update();
	await replacement; await obsolete;
	assert.equal(view.state, 'ready', view.error);
	assert.equal(view.session!.geometry.visuals[0].ox, 21 + 8);
	view.selectTimeline(view.session!.timelines[0]); await view.update();
	view.seek(750); const obsoleteSeek = view.update();
	model.undo(); await view.update(); await obsoleteSeek;
	assert.equal(view.state, 'ready', view.error);
	assert.equal(view.time, 750, 'rebuilding retains the requested sample, not the cancelled frame');
	assert.equal(view.session!.geometry.visuals[0].ox, 16 + 72);
});

test('a live Scene keeps its exact published plan after another declaration overwrites the registry key', async t => {
	const { view, models, sources } = await openPreview(t);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'cart.lua' })!;
	const entry = resolveLuaTextFileModel(models, sources.catalog, resource);
	const construction = 'scene_library.instantiate(root_scene.id)', offset = entry.buffer.getText().indexOf(construction);
	assert.notEqual(offset, -1);
	entry.pushEditOperations([{ offset, deleteLength: construction.length, text: "scene_library.instantiate('studio_test.initialized_text')\n\tscene_library.register('studio_test.initialized_text', {objects={}})" }]);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	assert.equal(view.session!.origin, 'initialized-instance');
	assert.equal(view.session!.timelines.length, 1);
	assert.equal(view.session!.geometry.visuals.length, 1);
});
