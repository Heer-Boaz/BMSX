import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ResourcePanelDrag } from '../../ide/workbench/contrib/resources/panel/drag';
import type { ProspectiveEditorOpenSource } from '../../ide/workbench/services/editor/editor_opening';

const down: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: 10, viewportY: 10,
	pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
	modifiers: KeyModifier.none, spaceDown: false };
const source: ProspectiveEditorOpenSource = { kind: 'opening', isCurrent: () => true,
	findExisting() { assert.fail('a drag does not resolve an editor'); }, resolve() { assert.fail('a drag does not open an editor'); } };

test('resource drag admission cannot revive a retired owner or open its source on release', t => {
	pointerCapture.interrupt(false);
	let updates = 0, drops = 0, clicks = 0;
	const drag = new ResourcePanelDrag({ update() { updates++; }, drop() { drops++; }, clear() {} });
	t.after(() => { drag.cancel(); pointerCapture.interrupt(false); });
	pointerCapture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { drag.cancel(); } });
	drag.begin(source, down, 0, () => clicks++);
	assert.equal(pointerCapture.active, false);
	pointerCapture.dispatch({ ...down, viewportX: 50, justPressedButtons: 0 }, false, 10);
	pointerCapture.dispatch({ ...down, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 20);
	assert.equal(updates, 0); assert.equal(drops, 0); assert.equal(clicks, 0);
});

test('resource feedback retirement keeps the newest source gesture admitted by its callback', t => {
	pointerCapture.interrupt(false);
	let replacement = false, clears = 0, firstClicks = 0, attemptedClicks = 0, newestClicks = 0;
	const drag = new ResourcePanelDrag({ update() {}, drop() { assert.fail('a stationary click is not a drop'); }, clear() {
		clears++;
		if (replacement) { replacement = false; drag.begin(source, down, 2, () => newestClicks++); }
	} });
	t.after(() => { drag.cancel(); pointerCapture.interrupt(false); });
	drag.begin(source, down, 0, () => firstClicks++);
	replacement = true; drag.begin(source, down, 1, () => attemptedClicks++);
	assert.equal(clears, 2); assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch({ ...down, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 3);
	assert.equal(firstClicks, 0); assert.equal(attemptedClicks, 0); assert.equal(newestClicks, 1);
	assert.equal(clears, 3); assert.equal(pointerCapture.active, false);
});
