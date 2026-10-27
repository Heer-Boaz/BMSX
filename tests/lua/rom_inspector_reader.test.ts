import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import * as colors from '../../ide/common/constants';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RomInspectorPane } from '../../ide/workbench/contrib/rom_inspector/editor_pane';
import type { RomInspectorSnapshot } from '../../ide/workbench/contrib/rom_inspector/model';
import { RomEntryInspectorWindow } from '../../ide/workbench/contrib/rom_inspector/reader_window';
import type { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import type { WorkbenchSurface } from '../../ide/workbench/services/windows/model';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { formatHexDumpRow } from '../../machine/ts/common/byte_hex_string';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { parseCartHeader } from '../../machine/ts/rompack/format';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../toolchain/ts/rompack/system_texture';
import { linkRawTestSystemBlua32 } from '../helpers/blua32';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

const area = { left: 0, top: 24, right: 384, bottom: 274 };
const point = (x: number, y: number, held = 0, down = 0, up = 0): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
});

function imageSnapshot(): RomInspectorSnapshot {
	const texture = encodeDirect16GxTexture(2, 2, Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255));
	const upload = encodeDirect16GxUpload(texture, 0, 0), end = 72 + upload.length;
	const rom = new Uint8Array(end + 1088); rom.set(upload, 72);
	for (let index = end; index < end + 1024; index++) rom[index] = index & 255;
	const assets: RomAsset[] = [
		{ resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 72, end },
		{ resid: 'a-image', type: 'image', source_path: 'a.lua', metabuffer_start: end + 1024, metabuffer_end: end + 1040,
			imgmeta: { width: 2, height: 2, texture_u: 0, texture_v: 0 } },
		{ resid: 'b-data', type: 'bin', source_path: 'b.lua', start: end, end: end + 1024 },
	];
	finalizePackedRomAssets(assets);
	return { domain: 0, sourceContextId: TEST_CARTRIDGE_CONTEXT_IDS[0], label: 'Captured cartridge', rom, assets, header: {
		headerSize: 72, manifestOffset: 72, manifestLength: 0, dataOffset: 72, dataLength: end + 1024 - 72,
		metadataOffset: end + 1024, metadataLength: 32, tocOffset: end + 1056, tocLength: 32,
		blua32ImageOffset: 0, blua32ImageByteCount: 0, blua32StartupFunctionAddress: 0, blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0, blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0,
	} };
}

test('ROM catalog commands dispatch from the actual focused list and after filter Enter', t => {
	configureFontVariant('tiny');
	const input = new RomInspectorInput(imageSnapshot()), surfaces = new WorkbenchSurfaceService();
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture), quickInput = new QuickInputController(contextMenu);
	const owner = surfaces.attach({ role: 'content', captureScope: Symbol('ROM catalog command owner'), getBounds: () => area,
		getClip: () => area, isVisible: () => true, draw() {} });
	const commands: EditorCommandRunner = { isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) };
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('a.lua', 1), createScenarioTestSourceRecord('b.lua', 2)]);
	const group = createTestEditorGroup(commands);
	const opened: Parameters<EditorNavigationController['openResource']>[] = [];
	const navigation = { openResource: async (...args: Parameters<EditorNavigationController['openResource']>) => { opened.push(args); return 1; } } as EditorNavigationController;
	const pane = new RomInspectorPane(commands, sources, navigation, quickInput, contextMenu, surfaces, owner, area, group, group.focusScope);
	t.after(() => { pane.clearInput(); pane.dispose(); quickInput.dispose(); contextMenu.dispose(); inputFocus.setTarget(null);
		pointerCapture.cancel(); pointerHover.clear(); surfaces.dispose(); input.dispose(); group.dispose(); });
	pane.setInput(input, area); pane.focus();
	const catalog = inputFocus.target;
	commands.execute('romInspector.structure');
	assert.equal(input.model.mode, 'structure', 'the focused catalog owns mode commands, not only its toolbar command context');
	assert.equal(input.model.rows.length, input.model.inspection.sections.length);
	commands.execute('list.find');
	assert.notEqual(inputFocus.target, catalog);
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, true));
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(inputFocus.target, catalog, 'filter Enter returns to the real catalog target');
	commands.execute('romInspector.assets');
	assert.equal(input.model.mode, 'assets'); assert.equal(input.model.rows.length, input.model.assets.length);
	input.model.select(input.model.rows.findIndex(row => row.label === 'a-image'));
	const subject = input.model.selection;
	commands.execute('romInspector.inspect');
	assert.equal(input.readerWindow.open, true); assert.equal(input.reader.subject, subject);
	pane.focus(); commands.execute('romInspector.source');
	assert.equal(opened.length, 1); assert.equal(opened[0][0], group); assert.equal(opened[0][1].path, 'a.lua');
	const catalogCommands = ['romInspector.key', 'romInspector.inspect', 'romInspector.assets', 'romInspector.structure',
		'romInspector.code', 'romInspector.sort', 'romInspector.source'] as const;
	pane.clearInput();
	for (const command of catalogCommands) assert.equal(catalog.getCommand(command)!.isEnabled(), false,
		'a retained catalog command cannot admit work after its editor input detaches');
	commands.execute('romInspector.structure', catalog);
	assert.equal(input.model.mode, 'assets', 'detached command references do not mutate their former input');
	pane.setInput(input, area); pane.focus();
	assert.equal(inputFocus.target, catalog, 'reattachment reuses the actual catalog control');
	commands.execute('romInspector.structure');
	assert.equal(input.model.mode, 'structure', 'the retained control admits work again only after attachment');
});

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', theme = 'light', snapshot = imageSnapshot()) {
	const previousTheme = colors.getActiveIdeThemeVariant(), previousCommands = inputFocus.workbenchScope.commands;
	configureFontVariant(variant); colors.setIdeThemeVariant(theme);
	const commands: EditorCommandRunner = { isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) };
	const group = createTestEditorGroup(commands);
	const input = new RomInspectorInput(snapshot), surfaces = new WorkbenchSurfaceService(), origin = inputFocus.createTarget(group.tabFocusTarget);
	Object.assign(input.layout, { ...area, right: variant === 'tiny' ? 78 : 118, bottom: 256, font: editorViewState.font, rowHeight: editorViewState.lineHeight });
	origin.bindKeyboard(() => {});
	const owner = surfaces.attach({ role: 'content', captureScope: origin.scope.surfaceScope, getBounds: () => input.layout,
		getClip: () => input.layout, isVisible: () => true, draw() {} });
	const contextMenu = new ContextMenuController(inputFocus, pointerCapture), quickInput = new QuickInputController(contextMenu);
	const popup: WorkbenchSurface = surfaces.attach({ role: 'modal', blockedScope: null, lifetimeOwner: owner, captureScope: quickInput.pointerScope,
		getBounds: () => quickInput.layout.bounds, getClip: () => area, isVisible: () => quickInput.visible, draw() {} });
	const unbind = inputFocus.bindScopeAdmission(scope => {
		const surface = surfaces.findByScope(scope.surfaceScope); return surface !== undefined && surfaces.isAdmitted(surface);
	});
	inputFocus.workbenchScope.commands = commands; origin.focus();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('a.lua', 1), createScenarioTestSourceRecord('b.lua', 2)]);
	const opened: Parameters<EditorNavigationController['openResource']>[] = [];
	const navigation = { openResource: async (...args: Parameters<EditorNavigationController['openResource']>) => { opened.push(args); return 1; } } as EditorNavigationController;
	const createReader = () => new RomEntryInspectorWindow(input, commands, sources, navigation, quickInput, contextMenu, surfaces, owner, origin, group, area);
	let reader = createReader();
	const overlay = createHostOverlayFixture(384, 288);
	const key = (code: string, down: boolean, modifiers = KeyModifier.none) => inputFocus.handleKeyboard(new KeyInputEvent(code, modifiers, false, down));
	const press = (code: string, modifiers = KeyModifier.none) => { key(code, true, modifiers); key(code, false, modifiers); };
	const select = (label: string) => { input.model.select(input.model.rows.findIndex(row => row.label === label)); reader.update(); };
	const choose = (label: string) => {
		reader.execute('romInspector.content');
		const index = quickInput.model.items.findIndex(item => item.label === label); assert.ok(index >= 0, `missing actual content choice ${label}`);
		press('Home', KeyModifier.ctrl); for (let step = 0; step < index; step++) press('ArrowDown'); press('Enter'); reader.update();
	};
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); surfaces.draw(api); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = []; let bitmaps = 0;
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Bitmap) bitmaps++;
		}
		return { glyphs, bitmaps };
	};
	t.after(() => { reader.dispose(); quickInput.dispose(); contextMenu.dispose(); popup?.dispose(); inputFocus.setTarget(null);
		pointerCapture.cancel(); pointerHover.clear(); unbind(); surfaces.dispose(); input.dispose(); group.dispose();
		inputFocus.workbenchScope.commands = previousCommands; colors.setIdeThemeVariant(previousTheme); });
	return { group, input, surfaces, owner, origin, commands, sources, opened, quickInput, press, key, select, choose, draw,
		get reader() { return reader; }, recreate() { reader.dispose(); reader = createReader(); } };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} reader paints exactly one full-width client view with its actual bytes and no second inspector chrome`, t => {
		const f = fixture(t, variant, theme); f.select('a-image'); f.reader.show();
		assert.equal(f.reader.window.surface!.lifetimeOwner, f.owner);
		assert.equal(f.reader.window.clientSurface!.presentationParent, f.reader.window.surface);
		assert.ok(f.input.readerWindow.bounds.right > f.input.layout.right, 'reading width comes from the root workspace, not the minimum catalog');
		assert.equal(f.draw().bitmaps, 1); assert.equal(f.reader.inspector.visible, false);
		f.choose('Properties'); const info = f.draw();
		assert.equal(info.bitmaps, 0); assert.ok(info.glyphs.some(glyph => glyph.items === 'Name'));
		assert.equal(f.reader.inspector.chrome, 'client'); assert.equal(f.reader.inspector.actionBar.items.some(item => item.visible), false);
		f.choose('Metadata'); const bytes = f.draw(), range = f.input.reader.selectedRange!;
		assert.equal(bytes.bitmaps, 0); assert.equal(f.reader.inspector.visible, false);
		assert.ok(bytes.glyphs.some(glyph => glyph.items === formatHexDumpRow(f.input.snapshot.rom, range.start, range.end, f.reader.presentation.byteColumns)));
		assert.equal(f.input.readerWindow.open, true);
	});
}

test('Hold and Follow bind exact shown identities, including an empty catalog, and Source uses the displayed resource', t => {
	const f = fixture(t); f.select('a-image'); f.reader.show(); const held = f.input.reader.subject;
	f.reader.execute('romInspector.hold'); f.select('b-data');
	assert.equal(f.input.readerHeld, true); assert.equal(f.input.reader.subject, held);
	f.reader.execute('romInspector.source');
	assert.equal(f.opened[0][0], f.group);
	assert.equal(f.opened[0][1], f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'a.lua' }));
	f.reader.execute('romInspector.hold'); assert.equal(f.input.reader.subject, f.input.model.selection);
	f.reader.execute('romInspector.source'); assert.equal(f.opened[1][0], f.group);
	assert.equal(f.opened[1][1], f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'b.lua' }));
	f.input.model.filter = 'no matching asset'; f.input.model.project(); f.reader.update();
	assert.equal(f.input.reader.subject, undefined); assert.ok(f.draw().glyphs.some(glyph => glyph.items === 'No entry selected'));
	f.reader.window.hide(); f.input.model.filter = ''; f.input.model.project(); f.reader.update();
	assert.equal(f.input.reader.subject, undefined, 'a closed reader must not follow the catalog');
	f.reader.show(); assert.equal(f.input.reader.subject, f.input.model.selection);
});

test('reader view changes, collapse and controller recreation preserve the same bitmap and reading positions', t => {
	const f = fixture(t); f.select('a-image'); f.reader.show(); const bitmap = f.input.reader.preview!;
	let released = 0; bitmap.onDispose(() => { released++; });
	f.input.reader.imageView.setScale(16); const scale = f.input.reader.imageView.mode;
	f.choose('Properties'); f.press('End'); f.reader.update();
	const selected = f.reader.inspector.model.selectionIndex, scroll = f.reader.inspector.model.viewport.scrollTop;
	assert.ok(selected > 0); assert.ok(scroll > 0, 'the retained Info bookmark must exercise a genuinely scrolled document');
	f.choose('Metadata'); f.choose('Preview');
	assert.equal(f.input.reader.preview, bitmap); assert.equal(f.input.reader.imageView.mode, scale);
	f.choose('Properties'); assert.equal(f.reader.inspector.model.selectionIndex, selected); assert.equal(f.reader.inspector.model.viewport.scrollTop, scroll);
	f.reader.window.setCollapsed(true); f.reader.update(); assert.equal(f.reader.window.clientSurface, undefined);
	f.recreate(); f.reader.update(); assert.equal(f.input.readerWindow.collapsed, true); assert.equal(f.input.reader.preview, bitmap);
	f.reader.window.setCollapsed(false); f.reader.update(); assert.equal(f.reader.inspector.model.selectionIndex, selected);
	assert.equal(f.reader.inspector.model.viewport.scrollTop, scroll); assert.equal(released, 0);
	f.commands.execute('window.hide', f.reader.inspector.focusTarget);
	assert.equal(f.input.readerWindow.open, false); assert.equal(inputFocus.target, f.origin); assert.equal(f.input.reader.preview, bitmap);
});

test('an actual image capture is retired before Follow retargets pixels, and hidden clients stay lazy', t => {
	const f = fixture(t); f.select('a-image'); f.reader.update(); assert.equal(f.input.reader.preview, undefined);
	f.input.readerWindow.setCollapsed(true); f.reader.show();
	assert.equal(f.input.reader.subject, f.input.model.selection); assert.equal(f.input.reader.preview, undefined);
	f.reader.window.setCollapsed(false); f.reader.update(); const bitmap = f.input.reader.preview!;
	let released = 0; bitmap.onDispose(() => { released++; });
	const bounds = f.input.reader.imageView.bounds, down = point(bounds.left + 3, bounds.top + 3, 1, 1);
	pointerCapture.beginRoute(f.reader.window.clientScope.surfaceScope, down); f.reader.window.clientSurface!.handlePointer!(down, 0);
	assert.equal(pointerCapture.active, true); f.select('b-data');
	assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true); assert.equal(released, 1);
	assert.equal(f.input.reader.subject, f.input.model.selection); assert.equal(f.input.reader.preview, undefined);
	const up = point(down.viewportX, down.viewportY, 0, 0, 1); pointerCapture.dispatch(up, false, 1); pointerCapture.endRoute(up);
	assert.equal(inputFocus.target, f.reader.inspector.focusTarget); f.press('Escape');
	assert.equal(inputFocus.target, f.origin); assert.equal(f.input.readerWindow.open, true);
	f.commands.execute('window.collapse', f.reader.inspector.focusTarget); f.reader.update();
	const properties = t.mock.getter(f.input.reader, 'properties');
	for (let frame = 0; frame < 1000; frame++) f.reader.update();
	assert.equal(properties.mock.callCount(), 0); assert.equal(f.draw().bitmaps, 0);
});

test('a held function paints its captured disassembly after the catalog changes mode', t => {
	const text = new Uint8Array(3 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 0, 0, 0, 0); writeInstruction(text, 1, OpCode.MOV, 1, 2, 0, 0); writeInstruction(text, 2, OpCode.RET, 0, 0, 0, 0);
	const linked = linkRawTestSystemBlua32({ text, functions: [{ firstWord: 0, wordCount: 3 }] });
	const f = fixture(t, 'msx', 'dark', { domain: -1, sourceContextId: TEST_SYSTEM_CONTEXT_ID, label: 'System capture', rom: linked.romBytes, header: parseCartHeader(linked.romBytes), assets: [] });
	f.input.model.setMode('code'); f.reader.show(); f.reader.execute('romInspector.hold');
	const subject = f.input.reader.subject, lines = f.reader.presentation.lines.slice();
	assert.equal(subject!.kind, 'function'); assert.equal(lines.length, 2); assert.ok(lines.some(line => /MOV/.test(line)));
	f.input.model.setMode('structure'); f.reader.update();
	assert.equal(f.input.reader.subject, subject); assert.deepEqual(f.reader.presentation.lines, lines);
	assert.ok(f.draw().glyphs.some(glyph => glyph.items === lines[0])); assert.equal(f.reader.isEnabled('romInspector.source'), false);
});

test('byte reading stays anchored to its document offset when window columns or font metrics change', t => {
	const f = fixture(t); f.select('b-data'); f.reader.show(); f.choose('Payload');
	f.press('PageDown'); f.reader.update();
	const range = f.input.reader.selectedRange!;
	const address = () => range.start + f.reader.presentation.firstLine * f.reader.presentation.byteColumns;
	const first = address(), columns = f.reader.presentation.byteColumns;
	assert.ok(first > range.start);
	const window = f.input.readerWindow, requested = window.requestedBounds;
	window.setRequestedBounds({ left: requested.left, top: requested.top,
		right: requested.left + window.minimumWidth, bottom: requested.bottom }); f.reader.update();
	assert.ok(f.reader.presentation.byteColumns < columns);
	assert.equal(address(), first, 'narrowing columns must not reinterpret pixel scroll as another byte offset');
	f.reader.window.hide(); f.recreate();
	configureFontVariant('msx'); f.reader.show(); f.reader.update();
	assert.equal(address(), first, 'input-owned reading metrics survive controller detachment and a font change');
});

test('a collapsed reader admits subject actions but not detached client view commands', t => {
	const f = fixture(t); f.select('a-image'); f.input.readerWindow.setCollapsed(true); f.reader.show();
	assert.equal(f.reader.window.clientSurface, undefined); assert.equal(f.input.reader.preview, undefined);
	assert.equal(f.reader.isEnabled('romInspector.source'), true); assert.equal(f.reader.isEnabled('romInspector.hold'), true);
	for (const command of ['romInspector.content', 'romInspector.zoom', 'romInspector.collision'] as const) {
		assert.equal(f.reader.isEnabled(command), false);
		f.reader.execute(command);
	}
	assert.equal(f.quickInput.visible, false); assert.equal(f.input.reader.preview, undefined);
});
