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
import { SceneRuntimePreview } from '../../ide/workbench/contrib/scene_editor/runtime_preview';
import { RuntimeGuestFault } from '../../ide/runtime/fault_state';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { readRuntimeLuaModuleExport } from '../../ide/runtime/lua_inspection';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { ScenePreviewCommands } from '../../ide/workbench/contrib/scene_editor/preview_commands';
import { PlayEvidence } from '../../ide/workbench/services/play/evidence';

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
	const entryResource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'cart.lua' })!;
	const entry = resolveLuaTextFileModel(models, sources.catalog, entryResource);
	const runs = new ScenarioRunService(models, sources, new Map(), PSX_MACHINE_SPEC,
		(system, slots, machine, input) => new OffscreenMachine(system, slots, machine, input));
	const document = documents.get(model), scene = document.scenes.find(scene => stringLiteralValue(scene.id) === 'studio_test.initialized_text')!;
	assert.ok(scene);
	const authoring = new SceneAuthoringContext(model, documents, { document, scene, sourceVersion: model.version });
	const service = new ScenePreviewService(models, sources, new Map(), PSX_MACHINE_SPEC, runs);
	const fixture = service.initializations(model.identity.contextId).find(module => module.resource.path.endsWith('/scene_preview_assert.lua'))!;
	assert.ok(fixture);
	const setupResource = sources.catalog.resolveResource(fixture.resource)!;
	const setup = resolveLuaTextFileModel(models, sources.catalog, setupResource);
	setup.pushEditOperations([{ offset: 0, deleteLength: setup.buffer.length, text: await readFile('tests/carts/studio_test/scene_preview_assert.lua', 'utf8') }]);
	const viewport = new SceneViewportViewState(authoring, sources.catalog); viewport.connectPreview(service);
	const view = viewport.runtime!;
	view.chooseInitialization(fixture.resource);
	t.after(async () => { viewport.dispose(); await service.dispose(); runs.dispose(); authoring.dispose(); models.clear(); resetSemanticProjects(models); sources.catalog.dispose(); });
	return { sources, models, documents, model, source, document, scene, authoring, service, view, viewport, entry, setup };
}

function pointer(x: number, y: number, buttons: number, justPressed = 0, justReleased = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: buttons, justPressedButtons: justPressed, justReleasedButtons: justReleased,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

test('real Scene preview uses caller-initialized text and seeks presentation without moving its authored anchor', async t => {
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
	assert.equal(preview.timelines.length, 1);
	assert.ok(preview.frame.bitmap);
	assert.equal(preview.geometry.visuals.length, 1);
	const initial = { ...preview.geometry.visuals[0] };
	const firstImage = new Uint8Array(preview.frame.bitmap.image.pixels);
	// Pick a genuinely drawn glyph pixel, not merely the text layout envelope.
	const image = preview.frame.bitmap.image;
	let ink = -1;
	for (let pixel = 0; pixel < image.width * image.height; pixel++) {
		const x = pixel % image.width, y = (pixel - x) / image.width;
		if (preview.geometry.pick(x, y) !== 1) continue;
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

test('initialization chooser configures only its captured Scene document and leaves source history alone', async t => {
	const { view, viewport, model, setup, service } = await openPreview(t);
	configureFontVariant('tiny');
	const bounds = { left: 0, top: 0, right: 512, bottom: 384 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const picker = new QuickInputController(menu, undefined, undefined, { kind: 'workspace', scope: inputFocus.workbenchScope, bounds });
	const scope = new InputFocusScope(Symbol('preview commands'), inputFocus.workbenchScope), target = inputFocus.createTarget(null, scope);
	target.commandContext = target; target.focus();
	let current = true;
	const commands = new ScenePreviewCommands(target, viewport, service, picker, () => current);
	t.after(() => { commands.dispose(); picker.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	view.chooseInitialization(undefined);
	const command = target.getCommand('scenePreview.initialization')!;
	assert.equal(command.isEnabled(), true); command.run();
	assert.equal(picker.visible, true);
	const version = model.version, setupVersion = setup.version;
	picker.model.list.selectionIndex = 1; await picker.accept();
	assert.deepEqual(view.initialization, setup.identity);
	assert.equal(view.state, 'stopped'); assert.equal(model.version, version); assert.equal(setup.version, setupVersion);
	const other = service.create(view.authoring);
	assert.equal(other.initialization, undefined);
	command.run(); picker.model.list.selectionIndex = 0;
	current = false; await picker.accept();
	assert.deepEqual(view.initialization, setup.identity, 'retired picker does not configure another document');
});

test('fixture setup selects one exact instance among repeated plans and normal close runs teardown, never a test body', async t => {
	const { view, setup } = await openPreview(t);
	const source = setup.buffer.getText(), offset = source.indexOf('\t\tt.scene =');
	setup.pushEditOperations([{ offset, deleteLength: 0,
		text: "\t\tlocal other = scenes.instantiate('studio_test.initialized_text', { caption = { content = 's' } })\n" }]);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	const session = view.session!, guest = session.guest;
	const execution = readRuntimeLuaModuleExport(session.media, guest, 0, 'testlib/execution');
	assert.equal(execution.kind, 'value'); if (execution.kind !== 'value') assert.fail();
	const selected = guest.readStringMember(guest.readStringMember(execution.value, 'context'), 'scene') as Table;
	assert.equal(session.sceneHashId, selected.hashId);
	assert.equal(session.geometry.visuals.length, 1);
	assert.equal(guest.global('studio_test_preview_case_ran'), null);
	view.stop(); await session.dispose();
	assert.equal(guest.global('studio_test_preview_cleaned'), true);
	assert.equal(session.frame.bitmap, undefined); assert.equal(session.geometry.visuals.length, 0);
});

test('setup working-copy changes and Undo rebuild the chosen initialization without editing the Scene', async t => {
	const { view, setup, model, source } = await openPreview(t);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	const initial = new Uint8Array(view.session!.frame.bitmap!.image.pixels);
	const offset = setup.buffer.getText().indexOf("content = 'studio'") + "content = '".length;
	setup.pushEditOperations([{ offset, deleteLength: 6, text: 'st' }]);
	assert.equal(view.session, undefined);
	await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.notDeepEqual(view.session!.frame.bitmap!.image.pixels, initial);
	assert.equal(model.buffer.getText(), source);
	setup.undo(); await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.deepEqual(view.session!.frame.bitmap!.image.pixels, initial);
});

test('cancelling an admitted cooperative setup joins teardown and never publishes the cancelled preview', async t => {
	const { view, setup } = await openPreview(t);
	const text = setup.buffer.getText(), offset = text.indexOf('\n\tend,', text.indexOf('t.scene ='));
	setup.pushEditOperations([{ offset, deleteLength: 0, text: "\n\t\tt:log('ready to cancel')\n\t\tt:wait_ticks(240)\n\t\terror('cancelled setup continued')" }]);
	let retired: SceneRuntimePreview | undefined;
	const log = PlayEvidence.prototype.log;
	t.mock.method(PlayEvidence.prototype, 'log', function(this: PlayEvidence, ...args: Parameters<PlayEvidence['log']>) {
		log.apply(this, args);
		retired = view.session!; view.stop();
	});
	await view.start();
	assert.ok(retired); await retired.dispose();
	assert.equal(view.state, 'stopped', view.error); assert.equal(view.session, undefined);
	assert.equal(retired.guest.global('studio_test_preview_cleaned'), true);
	assert.equal(retired.frame.bitmap, undefined); assert.equal(retired.geometry.visuals.length, 0);
});

for (const selection of ['missing', 'different-declaration'] as const) test(`fixture ${selection} Scene selection is not replaced with an inferred instance`, async t => {
	const { view, setup } = await openPreview(t);
	const text = setup.buffer.getText(), offset = text.indexOf('\n\tend,', text.indexOf('t.scene ='));
	setup.pushEditOperations([{ offset, deleteLength: 0, text: selection === 'missing' ? '\n\t\tt.scene = nil'
		: "\n\t\tt.scene = scenes.instantiate('studio_test.text')" }]);
	await view.start(); assert.equal(view.state, 'failed');
	assert.equal(view.session, undefined); assert.equal(view.selectedTimeline, undefined);
	setup.undo(); await view.update(); assert.equal(view.state, 'ready', view.error);
});

test('teardown failure is reported without trapping a corrected setup in the retired machine', async t => {
	const { view, setup } = await openPreview(t);
	const source = setup.buffer.getText(), offset = source.indexOf('\t\tt.scene:dispose()');
	setup.pushEditOperations([{ offset, deleteLength: 0, text: "\t\terror('cleanup fault')\n" }]);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	const session = view.session!;
	view.stop(); await assert.rejects(session.dispose(), RuntimeGuestFault);
	assert.equal(view.state, 'failed'); assert.ok(view.error!.includes('cleanup fault'));
	setup.undo(); await view.start(); assert.equal(view.state, 'ready', view.error);
});

test('independent Scene previews retire cancelled builds and seeks without touching another document', async t => {
	const { view, models, sources, documents, service } = await openPreview(t);
	const model = resolveLuaTextFileModel(models, sources.catalog, sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scenes/root.lua' })!);
	const document = documents.get(model), scene = document.scenes[0];
	const otherAuthoring = new SceneAuthoringContext(model, documents, { document, scene, sourceVersion: model.version });
	t.after(() => otherAuthoring.dispose());
	const other = service.create(otherAuthoring);
	const cancelledBuild = view.start(); view.stop(); await cancelledBuild;
	assert.equal(view.state, 'stopped'); assert.equal(view.session, undefined);
	await Promise.all([view.start(), other.start()]);
	assert.equal(view.state, 'ready', view.error); assert.equal(other.state, 'ready', other.error);
	assert.notEqual(view.session!.execution.runtime, other.session!.execution.runtime);
	assert.equal(view.session!.geometry.visuals.length, 1); assert.equal(other.session!.geometry.visuals.length, 3);
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
	const { view, setup } = await openPreview(t);
	const text = setup.buffer.getText(), offset = text.indexOf("\n\tend,", text.indexOf('t.scene ='));
	setup.pushEditOperations([{ offset, deleteLength: 0, text: "\n\t\tscenes.register('studio_test.initialized_text', {objects={}})" }]);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	assert.equal(view.session!.timelines.length, 1);
	assert.equal(view.session!.geometry.visuals.length, 1);
});

test('a registered Scene without its caller initialization neither constructs members nor clears the booted World', async t => {
	const { setup, service, scene, model, view, viewport } = await openPreview(t);
	view.chooseInitialization(undefined); // Ordinary boot admits only the root.
	const preview = new SceneRuntimePreview(await service.build(model.identity.contextId));
	t.after(() => preview.dispose());
	await assert.rejects(preview.initialize({ modulePath: 'scenes/text', registration: scene.registrationRange, memberCount: scene.objects.length }));
	assert.equal(preview.execution.runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 0);
	const guest = preview.guest, rootActor = guest.global('studio_test_actor');
	assert.notEqual(rootActor, null);
	const world = readRuntimeLuaModuleExport(preview.media, guest, 0, 'cartlib/world/world');
	assert.equal(world.kind, 'value');
	if (world.kind !== 'value') assert.fail('booted World must remain available');
	const objects = guest.readStringMember(world.value, '_objects') as Table;
	assert.ok(objects.arrayLength > 0);
	let admittedRoot = false;
	for (let index = 1; index <= objects.arrayLength; index++) {
		const object = objects.getInteger(index);
		if (object === rootActor) admittedRoot = true;
		assert.equal(guest.readStringMember(object, 'timelines'), null, 'the uninitialized caption was not constructed');
	}
	assert.equal(admittedRoot, true);
	assert.equal(preview.frame.bitmap, undefined); assert.equal(preview.geometry.visuals.length, 0);
	await view.start(); assert.equal(view.state, 'failed'); assert.equal(view.session, undefined);
	assert.equal(viewport.canFrameAll, false);
	view.stop(); assert.equal(view.error, undefined);
	view.chooseInitialization(setup.identity); await view.start(); assert.equal(view.state, 'ready', view.error);
	assert.equal(view.session!.timelines.length, 1);
});

test('a preview boot fault retains its guest source and call stack instead of expiring the execution budget', async t => {
	const { entry, service, scene, model, source } = await openPreview(t);
	const construction = 'scene_library.instantiate(root_scene.id)', offset = entry.buffer.getText().indexOf(construction);
	assert.notEqual(offset, -1);
	entry.pushEditOperations([{ offset, deleteLength: construction.length, text: "scene_library.instantiate('studio_test.initialized_text')" }]);
	const preview = new SceneRuntimePreview(await service.build(model.identity.contextId));
	t.after(() => preview.dispose());
	await assert.rejects(preview.initialize({ modulePath: 'scenes/text', registration: scene.registrationRange, memberCount: scene.objects.length }), error => {
		assert.ok(error instanceof RuntimeGuestFault, String(error));
		// Exact attribution to the current admitted source is the diagnostic contract.
		const caller = error.snapshot.details.luaStack.find(frame => frame.kind === 'source' && frame.resource.path === model.identity.path)!;
		assert.ok(caller.kind === 'source');
		assert.deepEqual(caller.resource, model.identity);
		assert.equal(caller.line, source.split('\n').findIndex(line => line.includes('string.upper(owner.content)')) + 1);
		assert.ok(error.snapshot.details.luaStack.some(frame => frame.functionName === 'new_game'));
		assert.equal(error.snapshot.resource!.path, 'string/base.lua');
		assert.ok(error.message.includes(`string/base.lua:${error.snapshot.line}:`));
		assert.ok(error.stack!.includes('new_game'));
		return true;
	});
});

test('a timeline call fault retires its pixels, picks and slider; source Undo rebuilds the requested sample', async t => {
	const { model, source, view, viewport } = await openPreview(t);
	const call = "\ttransport:seek_time('presentation', 0)", offset = source.indexOf(call);
	assert.notEqual(offset, -1);
	model.pushEditOperations([{ offset, deleteLength: 0, text: `\tfunction transport:seek_time(id, time)
\t\tif time == 750 then error('fixture seek fault') end
\t\treturn timeline_component.seek_time(self, id, time)
\tend
` }]);
	await view.start(); assert.equal(view.state, 'ready', view.error);
	const session = view.session!;
	view.selectTimeline(session.timelines[0]); await view.update(); assert.equal(view.state, 'ready', view.error);
	view.seek(750); await view.update();
	assert.equal(view.state, 'failed'); assert.equal(view.session, undefined); assert.equal(view.selectedTimeline, undefined);
	assert.equal(session.frame.bitmap, undefined); assert.equal(session.geometry.visuals.length, 0);
	assert.equal(viewport.canFrameAll, false);
	assert.ok(view.error!.includes('scenes/text.lua:')); assert.ok(view.error!.includes('fixture seek fault'));
	model.undo(); await view.update(); assert.equal(view.state, 'ready', view.error);
	assert.equal(model.buffer.getText(), source); assert.equal(view.time, 750);
	assert.equal(view.session!.geometry.visuals[0].ox, 16 + 72);
});
