import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { createActualSourcePanes } from '../helpers/source_panes';

test('secondary press in an empty group body opens that group menu without selecting another input or group', async t => {
	const f = createActualSourcePanes(t), group = f.firstGroup;
	assert.equal(await group.close(f.firstInput.id), true); f.update(); f.second.focus();
	const focused = inputFocus.target, active = f.editor.editorParts.activeGroup, body = group.panes.contentBounds;
	const x = (body.left + body.right) / 2, y = (body.top + body.bottom) / 2;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Secondary : 0,
			pressedButtons: down ? PointerButton.Secondary : 0, releasedButtons: down ? 0 : PointerButton.Secondary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	}
	assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(group.model.activeTab === null && group.panes.activePane === null && f.editor.editorParts.activeGroup === active);
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'group.splitRight' && row.enabled));
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
	f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.target === focused);
});

for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const)
	test(`${code} on a real empty group invokes its own group menu and returns to that same empty client`, async t => {
		const f = createActualSourcePanes(t), group = f.firstGroup;
		assert.equal(await group.close(f.firstInput.id), true); f.update(); group.focus();
		assert.ok(inputFocus.target === group.focusTarget);
		f.key(code, modifiers); assert.equal(f.editor.contextMenu.visible, true);
		assert.ok(group.model.activeTab === null && group.panes.activePane === null);
		assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'group.move'));
		assert.ok(f.secondGroup.model.activeTab === f.secondInput);
		f.key('Escape'); assert.equal(f.editor.contextMenu.visible, false); assert.ok(inputFocus.target === group.focusTarget);
	});
