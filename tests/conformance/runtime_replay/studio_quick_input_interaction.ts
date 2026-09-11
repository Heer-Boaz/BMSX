import { pointerCapture } from '../../../ide/input/pointer/capture';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Actual shared file choice; no assumptions about the current cart's file names. */
export async function testStudioQuickInputInteraction(test: StudioFixture): Promise<void> {
	const { ide, press, frame, movePointer, setPointerButton, clipboard } = test;
	const picker = ide.editor.quickInput, tab = getActiveTab();
	// This first gate also runs against the old owners, before touching the new viewport API.
	const first = { left: picker.layout.bounds.left + 8, right: picker.layout.bounds.left + 12,
		top: picker.layout.field.bottom + 5, bottom: picker.layout.field.bottom + 7 };
	movePointer(first); await frame(); setPointerButton('pointer_primary', true); await frame();
	check(picker.visible && getActiveTab() === tab, 'A06: picker pointer down selects but does not accept or open source');
	const model = picker.model, view = model.viewport;
	check(pointerCapture.active, 'A06: the picker owns its physical row gesture');
	movePointer({ left: picker.layout.bounds.right + 2, right: picker.layout.bounds.right + 4, top: first.top, bottom: first.bottom });
	setPointerButton('pointer_primary', false); await frame();
	check(picker.visible && !pointerCapture.active && getActiveTab() === tab, 'A06: outside release cancels row acceptance without dismissing the query');
	check(model.list.rows.length > model.visibleRowCount, 'A06: the actual resource catalog exercises overflow');
	const rows = model.list.rows, firstRow = rows[0], font = ide.editor.fontVariant;
	for (const variant of ['msx', 'tiny'] as const) {
		ide.editor.setFontVariant(variant); await frame(); await frame();
		await press('ControlLeft', 'Home');
		const thumb = view.scrollbar.getThumb()!;
		movePointer(thumb); await frame(); setPointerButton('pointer_primary', true); await frame();
		check(pointerCapture.active && inputFocus.target === picker.field.focusTarget,
			`A06: ${variant} thumb capture keeps the query focus`);
		movePointer({ left: thumb.left, right: thumb.right, top: view.bounds.bottom - 4, bottom: view.bounds.bottom - 2 });
		await frame();
		check(pointerCapture.active && view.scrollTop > 0 && picker.visible, 'A06: the popup route admits its own captured scrollbar');
		setPointerButton('pointer_primary', false); await frame();
		check(!pointerCapture.active && inputFocus.target === picker.field.focusTarget, 'A06: releasing the thumb does not navigate or blur');
		await press('ControlLeft', 'End');
		check(model.list.selectionIndex === rows.length - 1
			&& model.rowTop(rows.length - 1) + model.rowHeight <= view.bounds.bottom,
			'A06: Ctrl+End reveals the final admitted choice');
		check(rows[rows.length - 1].labelText.length > 0, 'A06: newly visible choices have prepared text after keyboard reveal');
		await press('ControlLeft', 'Home');
		check(model.list.selectionIndex === 0 && view.scrollTop === 0, 'A06: Ctrl+Home reveals the first choice');
		for (let n = 0; n < 10; n += 1) await frame();
		check(model.list.rows === rows && rows[0] === firstRow, 'A06: idle and scrollbar movement retain admitted rows');
	}
	// Typing into the focused query while a row is held invalidates its admitted gesture.
	movePointer({ left: view.bounds.left + 2, right: view.bounds.left + 4, top: view.bounds.top + 2, bottom: view.bounds.top + 4 });
	await frame(); setPointerButton('pointer_primary', true); await frame();
	check(pointerCapture.active, 'A06: query-change proof starts with an actual held row');
	clipboard.text = rows[0].item.label;
	await press('ControlLeft', 'KeyV');
	check(!pointerCapture.active && picker.visible, 'A06: a new query cancels held row acceptance immediately');
	setPointerButton('pointer_primary', false); await frame();
	check(picker.visible && getActiveTab() === tab, 'A06: later release cannot accept a replacement query result');
	await press('ControlLeft', 'KeyZ');
	check(picker.field.text === '', 'A06: query Undo restores the initial catalog without touching source history');
	const thumb = view.scrollbar.getThumb()!;
	movePointer(thumb); await frame(); setPointerButton('pointer_primary', true); await frame();
	ide.editor.setFontVariant('msx'); await frame();
	check(!pointerCapture.active && picker.visible, 'A06: publishing changed popup geometry cancels the old thumb gesture');
	setPointerButton('pointer_primary', false); await frame();
	ide.editor.setFontVariant(font); await frame(); await frame();
	console.info('STUDIO: quick input scope / scrollbar / release / query / font / boundary keys PASS');
}
