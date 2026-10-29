import assert from 'node:assert/strict';
import test from 'node:test';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus } from '../../ide/input/focus';
import { WorkbenchTextViewControl } from '../../ide/workbench/ui/text_view/control';
import { WorkbenchTextViewModel } from '../../ide/workbench/ui/text_view/model';

test('retiring a focused Find publishes its old binding before focus return can admit a newer reader', t => {
	configureFontVariant('tiny');
	const parent = inputFocus.createTarget(), control = new WorkbenchTextViewControl(parent), font = new EditorFont('tiny');
	const old = new WorkbenchTextViewModel(new PieceTreeBuffer('previous raw document\r\n'));
	const next = new WorkbenchTextViewModel(new PieceTreeBuffer('next raw\t😀 document\r\n'));
	next.selectAll(); next.setQuery('next');
	const bounds = { left: 0, top: 0, right: 320, bottom: 180 };
	control.setInput(old); control.update(bounds, font, font.lineHeight); control.openFind();
	assert.ok(inputFocus.admittedTarget === control.findField.focusTarget);
	let returned = false;
	const unbind = parent.onDidFocus(() => {
		unbind(); returned = true;
		assert.equal(control.focusTarget.getCommand('text.find')!.isEnabled(), false);
		control.setInput(next); control.update(bounds, font, font.lineHeight); control.openFind();
	});
	t.after(() => { unbind(); inputFocus.setTarget(null); control.dispose(); });
	control.clearInput();
	assert.equal(returned, true);
	assert.ok(inputFocus.admittedTarget === control.findField.focusTarget);
	assert.equal(control.findVisible, true);
	assert.equal(control.findField.text, 'next');
	assert.equal(control.focusTarget.getCommand('text.find')!.isEnabled(), true);
	assert.equal(control.focusTarget.clipboard!.copy!(), 'next raw\t😀 document\r\n');
	control.findField.focusTarget.getCommand('text.findNext')!.run();
	assert.equal(next.copy(), 'next');
});
