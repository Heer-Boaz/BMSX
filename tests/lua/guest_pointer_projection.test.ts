import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { OffscreenVideoOutput } from '../../hosts/common/offscreen_video_output';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';
import { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { DisplayPointMappingResult } from '../../machine/ts/render/video_output';
import type { GuestInputBinding } from '../../ide/input/focus';
import { projectGuestPointer } from '../../ide/input/pointer/guest';
import { projectEditorPointerEvent } from '../../ide/input/pointer/frame';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';

test('direct guest projection uses the painted scanout extent and constrains captured outside motion', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const presenter = new VideoPresenter(new OffscreenVideoOutput(320, 240),
		new HeadlessGPUBackend(320, 240, PSX_MACHINE_SPEC.gxGpuVramBytes), 320, 240);
	// Studio's fixed render target is independent from the native source image.
	presenter.viewportSize.x = 1280; presenter.viewportSize.y = 720;
	const bounds = { left: 100, top: 50, right: 740, bottom: 530 };
	const binding: GuestInputBinding = { bounds, recipient: input, presentation: { kind: 'direct', presenter } };
	const target = { x: -1, y: -1 };
	assert.equal(projectGuestPointer(binding, 420, 290, target), DisplayPointMappingResult.Inside);
	assert.deepEqual(target, { x: 160, y: 120 });
	assert.equal(projectGuestPointer(binding, 740, 530, target), DisplayPointMappingResult.Outside);
	assert.deepEqual(target, { x: 319, y: 239 });
	assert.equal(projectGuestPointer(binding, -200, -200, target), DisplayPointMappingResult.Outside);
	assert.deepEqual(target, { x: 0, y: 0 });
	presenter.offscreenCanvasSize.x = 640; presenter.offscreenCanvasSize.y = 480;
	projectGuestPointer(binding, 420, 290, target);
	assert.deepEqual(target, { x: 320, y: 240 }, 'the source owner supplies the current painted texture extent');
	bounds.left = 0; bounds.top = 0; bounds.right = 320; bounds.bottom = 240;
	projectGuestPointer(binding, 160, 120, target);
	assert.deepEqual(target, { x: 320, y: 240 }, 'a retained binding follows the actual current preview placement');
	bounds.right = 0;
	assert.equal(projectGuestPointer(binding, 0, 0, target), DisplayPointMappingResult.Invalid);
});

test('offscreen projection follows the retained bitmap, including its held and republished image dimensions', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const frames = new FrameBitmap();
	t.after(() => { frames.dispose(); input.dispose(); });
	frames.publish(new Uint8Array(320 * 224 * 4), 320, 224, { presentationSequence: 7, cycles: 100, videoTick: 2 });
	const binding: GuestInputBinding = { bounds: { left: 20, top: 30, right: 660, bottom: 478 }, recipient: input,
		presentation: { kind: 'offscreen', frames } };
	const target = { x: 0, y: 0 };
	projectGuestPointer(binding, 340, 254, target);
	assert.deepEqual(target, { x: 160, y: 112 });
	for (let heldFrame = 0; heldFrame < 20; heldFrame += 1) {
		projectGuestPointer(binding, 340, 254, target);
		assert.deepEqual(target, { x: 160, y: 112 });
	}
	frames.publish(new Uint8Array(512 * 256 * 4), 512, 256, { presentationSequence: 8, cycles: 200, videoTick: 3 });
	projectGuestPointer(binding, 340, 254, target);
	assert.deepEqual(target, { x: 256, y: 128 }, 'bitmap replacement, not machine registers, changes the displayed raster');
});

test('browser display-to-Studio projection and remote Studio coordinates admit the same image point', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const frames = new FrameBitmap();
	const oldWidth = editorViewState.viewportWidth, oldHeight = editorViewState.viewportHeight;
	t.after(() => { frames.dispose(); input.dispose(); editorViewState.viewportWidth = oldWidth; editorViewState.viewportHeight = oldHeight; });
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	frames.publish(new Uint8Array(320 * 240 * 4), 320, 240, { presentationSequence: 1, cycles: 0, videoTick: 0 });
	const binding: GuestInputBinding = { bounds: { left: 64, top: 48, right: 320, bottom: 240 }, recipient: input,
		presentation: { kind: 'offscreen', frames } };
	const event = { x: 484, y: 368, buttons: 0, pressedButtons: 0, releasedButtons: 0, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 };
	const browser: PointerInputSnapshot = { viewportX: 0, viewportY: 0, valid: false, insideViewport: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: KeyModifier.none, spaceDown: false };
	const remote = { ...browser };
	projectEditorPointerEvent({ measureDisplay: () => ({ left: 100, top: 80, width: 768, height: 576 }) }, event, browser);
	projectEditorPointerEvent({ measureDisplay: () => ({ left: 0, top: 0, width: 384, height: 288 }) },
		{ ...event, x: 192, y: 144 }, remote);
	assert.deepEqual(browser, remote);
	const browserImage = { x: 0, y: 0 }, remoteImage = { x: 0, y: 0 };
	projectGuestPointer(binding, browser.viewportX, browser.viewportY, browserImage);
	projectGuestPointer(binding, remote.viewportX, remote.viewportY, remoteImage);
	assert.deepEqual(browserImage, { x: 160, y: 120 });
	assert.deepEqual(browserImage, remoteImage);
});
