import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { ResourceViewerEditorPane } from '../../ide/workbench/contrib/resources/editor_pane';
import { ResourceViewerInputSerializer } from '../../ide/workbench/contrib/resources/editor_serializer';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import type { HostBitmap } from '../../machine/ts/render/host_overlay/bitmap';
import { finalizePackedRomAssets, type RomAsset } from '../../toolchain/ts/rompack/assets';
import { encodeDirect16GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const expected = [new Uint8Array([255, 0, 0, 255]), new Uint8Array([0, 255, 0, 255])];
	const images = expected.map(pixels => {
		const texture = encodeDirect16GxTexture(1, 1, new Uint8ClampedArray(pixels));
		const bytes = new Uint8Array(encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount));
		const assets: RomAsset[] = [
			{ resid: 'shared-image', type: 'image', source_path: 'res/img/shared.png',
				imgmeta: { width: 1, height: 1, texture_u: 0, texture_v: 0, gx_atlas_id: 'shared-atlas' } },
			{ resid: 'shared-atlas', type: 'texture', start: 0, end: bytes.length, texturemeta: {
				mode: texture.mode, word_width: texture.wordWidth, height: texture.height,
				texture_word_count: texture.textureWordCount, clut_word_count: texture.clutWordCount,
			} },
		];
		finalizePackedRomAssets(assets);
		return { bytes, assets };
	});
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('machine/bios', ''),
		[createLuaSourceRegistry('carts/fixture', ''), null], 0,
		{ system: images[0].assets, cartridgeSlots: [images[1].assets, []] });
	const catalog = sources.catalog;
	const contexts = [catalog.getContext(sources.systemContextId), catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0])];
	const resources = contexts.map((context, index) => {
		const rom = context.previewRom!, { assets, bytes } = images[index];
		rom.bytes = bytes;
		rom.index.entries.push(...assets);
		context.previewPackage.img['shared-image'] = assets[0];
		const resource = catalog.resolveResource({ contextId: context.id, path: 'res/img/shared.png' });
		assert.ok(resource, 'the source catalog must publish its authored image resource');
		return resource;
	});
	const overlay = createHostOverlayFixture(240, 160);
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target),
	};
	const pane = new ResourceViewerEditorPane(inputFocus.workbenchScope, commands, menu);
	const submissions = t.mock.method(api, 'drawBitmap');
	const draw = (): HostBitmap => {
		submissions.mock.resetCalls();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		pane.draw(); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		assert.equal(submissions.mock.callCount(), 1, 'the resource image must submit its decoded bitmap, not reserve a blank client');
		return submissions.mock.calls[0].arguments[0];
	};
	t.after(() => { pane.dispose(); menu.dispose(); catalog.dispose(); });
	return { catalog, pane, resources, expected, draw, commands };
}

test('resource image rendering consumes the exact admitted source context even when asset and atlas IDs match', t => {
	const f = fixture(t), bitmaps: HostBitmap[] = [];
	for (let index = 0; index < f.resources.length; index++) {
		const resource = f.resources[index], input = new ResourceViewerInput(f.catalog, resource);
		t.after(() => input.dispose());
		f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 });
		assert.ok(f.pane.input.resource === resource);
		const bitmap = f.draw();
		// Pixel bytes are the data-integrity contract of decoding this exact packed image.
		assert.deepEqual(bitmap.image.pixels, f.expected[index]);
		bitmaps.push(bitmap);
		f.pane.clearInput();
	}
	assert.notEqual(bitmaps[0], bitmaps[1]);
});

test('a resource image bitmap belongs to its retained input across pane detach and explicit reopen, and ends at input disposal', t => {
	const f = fixture(t), input = new ResourceViewerInput(f.catalog, f.resources[0]);
	f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 });
	const bitmap = f.draw();
	let disposals = 0;
	bitmap.onDispose(() => { disposals++; });
	f.pane.clearInput();
	assert.equal(disposals, 0, 'detaching a reusable pane cannot dispose its retained input resource');
	f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 });
	assert.ok(f.draw() === bitmap, 'reopening an unchanged packed image must reuse its prepared bitmap');
	f.pane.clearInput();
	input.dispose();
	assert.equal(disposals, 1);
});

test('image/info switching, new views and workspace restoration retain independent reading state without decoding hidden views', t => {
	const f = fixture(t), input = new ResourceViewerInput(f.catalog, f.resources[0]); t.after(() => input.dispose());
	f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 }); f.pane.focus();
	const bitmap = f.draw(), imageTarget = f.pane.commandTarget;
	f.commands.execute('image.zoomIn', imageTarget);
	assert.equal(input.preview!.view.mode, 2);
	f.commands.execute('resourceViewer.info', imageTarget);
	assert.equal(input.view.contentView, 'info'); assert.ok(input.preview!.bitmap === bitmap);
	assert.equal(imageTarget.getCommand('image.fit')!.isEnabled(), false);
	const copy = input.createView(); t.after(() => copy.dispose());
	assert.equal(copy.preview, undefined);
	const serializers = new ResourceViewerInputSerializer(f.catalog), restored = serializers.deserialize(serializers.serialize(input));
	t.after(() => restored.dispose());
	assert.equal(restored.preview, undefined);
	for (const view of [copy, restored]) {
		f.pane.clearInput(); f.pane.setInput(view, { left: 0, top: 0, right: 240, bottom: 160 }); f.pane.focus();
		assert.equal(view.view.contentView, 'info'); assert.equal(view.preview, undefined);
		f.commands.execute('resourceViewer.preview', f.pane.commandTarget);
		assert.equal(view.preview!.view.mode, 2); assert.ok(view.preview!.bitmap !== bitmap);
		f.commands.execute('image.actualSize', f.pane.commandTarget); assert.equal(view.preview!.view.mode, 1);
	}
	assert.equal(input.preview!.view.mode, 2);
	f.pane.clearInput(); f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 }); f.pane.focus();
	f.commands.execute('resourceViewer.preview', f.pane.commandTarget);
	assert.ok(f.draw() === bitmap); assert.equal(input.preview!.view.mode, 2);
});

test('restored image state remains authoritative while Info is visible, including copy and workspace save before the next Preview', t => {
	const f = fixture(t), input = new ResourceViewerInput(f.catalog, f.resources[0]); t.after(() => input.dispose());
	f.pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 }); f.pane.focus();
	f.commands.execute('image.zoomIn', f.pane.commandTarget);
	f.commands.execute('resourceViewer.info', f.pane.commandTarget);
	const selection = f.pane.getSelection();
	f.commands.execute('resourceViewer.preview', f.pane.commandTarget);
	f.commands.execute('image.zoomIn', f.pane.commandTarget);
	assert.equal(input.preview!.view.mode, 4);
	f.pane.setOptions(undefined, selection);
	assert.equal(input.view.contentView, 'info');
	assert.equal(f.pane.getSelection().matches(selection), true);
	const copy = input.createView(), serializer = new ResourceViewerInputSerializer(f.catalog);
	const restored = serializer.deserialize(serializer.serialize(input));
	t.after(() => { copy.dispose(); restored.dispose(); });
	for (const view of [copy, restored]) {
		assert.equal(view.preview, undefined);
		assert.equal(view.imagePosition!.scale, 2);
	}
	f.commands.execute('resourceViewer.preview', f.pane.commandTarget);
	assert.equal(input.preview!.view.mode, 2);
});

test('restoring Preview retires an Info scrollbar gesture without scrolling the hidden reader', t => {
	const f = fixture(t), input = new ResourceViewerInput(f.catalog, f.resources[0]); t.after(() => input.dispose());
	const bounds = { left: 0, top: 0, right: 240, bottom: 50 };
	f.pane.setInput(input, bounds); f.pane.focus();
	const preview = f.pane.getSelection();
	f.commands.execute('resourceViewer.info', f.pane.commandTarget);
	const down = { viewportX: bounds.right - SCROLLBAR_WIDTH / 2, viewportY: 10, valid: true, insideViewport: true,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0, modifiers: 0, spaceDown: false };
	f.pane.handlePointer(down, true, false, 0, false);
	assert.equal(pointerCapture.active, true);
	f.pane.setOptions(undefined, preview);
	assert.equal(input.view.contentView, 'preview');
	assert.equal(pointerCapture.active, false);
	const scroll = input.view.scroll;
	pointerCapture.dispatch({ ...down, viewportY: 40, justPressedButtons: 0 }, false, 0);
	assert.equal(input.view.scroll, scroll);
});

test('resource image retirement cannot clear a newer same-pane attachment installed by its blur callback', t => {
	const f = fixture(t), first = new ResourceViewerInput(f.catalog, f.resources[0]), next = new ResourceViewerInput(f.catalog, f.resources[1]);
	t.after(() => { first.dispose(); next.dispose(); });
	const bounds = { left: 0, top: 0, right: 240, bottom: 160 };
	f.pane.setInput(first, bounds); f.pane.focus();
	const unbind = f.pane.commandTarget.onDidBlur(() => {
		unbind(); f.pane.clearInput(); f.pane.setInput(next, bounds); f.pane.focus();
	}); t.after(unbind);
	f.pane.clearInput();
	assert.ok(f.pane.input === next && inputFocus.admittedTarget === f.pane.commandTarget);
	assert.deepEqual(f.draw().image.pixels, f.expected[1]);
});
