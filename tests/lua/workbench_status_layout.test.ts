import assert from 'node:assert/strict';
import test from 'node:test';
import { ELLIPSIS } from '../../ide/common/text';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import type { WorkbenchStatusItem } from '../../ide/workbench/common/status_bar';
import { STATUS_PRIORITY_CONTENT, STATUS_PRIORITY_DETAIL, STATUS_PRIORITY_ERROR, STATUS_PRIORITY_HINT } from '../../ide/workbench/common/status_bar';
import { getWorkbenchConnectionBounds, getWorkbenchStatusLayout, getWorkbenchWorkArea, refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { STATUS_ITEM_PADDING, WorkbenchStatusItemsLayout } from '../../ide/workbench/ui/status_bar/layout';

function item(text: string, alignment: 'left' | 'right', priority = STATUS_PRIORITY_CONTENT,
	overflow: 'ellipsis' | 'hide' = 'ellipsis'): WorkbenchStatusItem {
	return { text, alignment, priority, overflow, tone: 'normal' };
}

// Geometry is the contract of this allocator: producers publish complete facts,
// while every admitted presentation owns a disjoint measured rectangle.
for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} measured status allocation admits by priority without changing visual input order`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const input = [item('first', 'left', 1), item('second', 'left', 30), item('third', 'right', 20), item('fourth', 'right', 10)];
		const bounds = { left: 14, top: 40, right: 640, bottom: 40 + font.lineHeight };
		assert.equal(layout.update(input, bounds, font), true);
		assert.equal(layout.overflow, false);
		for (let index = 0; index < input.length; index++) {
			const entry = layout.items.peek(index);
			assert.ok(entry.item === input[index]); assert.equal(entry.fullText, input[index].text);
			assert.equal(entry.visible, true); assert.equal(entry.truncated, false);
			assert.equal(entry.bounds.right - entry.bounds.left, font.measure(entry.fullText) + STATUS_ITEM_PADDING * 2);
			assert.ok(entry.bounds.left >= bounds.left && entry.bounds.right <= bounds.right);
			for (let other = index + 1; other < input.length; other++) {
				const next = layout.items.peek(other);
				assert.ok(entry.bounds.right <= next.bounds.left || next.bounds.right <= entry.bounds.left);
			}
		}
		assert.ok(layout.items.peek(0).bounds.left < layout.items.peek(1).bounds.left);
		assert.ok(layout.items.peek(2).bounds.left < layout.items.peek(3).bounds.left);
	});

	test(`${variant} narrow status keeps important complete facts rather than a lower priority hint`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const hint = item('a much longer optional gesture hint', 'right', STATUS_PRIORITY_HINT, 'hide');
		const content = item('12:34', 'left', STATUS_PRIORITY_CONTENT);
		const bounds = { left: 14, top: 0, right: 14 + font.measure(content.text) + STATUS_ITEM_PADDING * 2, bottom: font.lineHeight };
		layout.update([hint, content], bounds, font);
		assert.equal(layout.items.peek(0).visible, false);
		assert.equal(layout.items.peek(1).visible, true); assert.equal(layout.items.peek(1).truncated, false);
		assert.equal(layout.items.peek(1).text, content.text); assert.equal(layout.overflow, true);
		assert.equal(hint.text, 'a much longer optional gesture hint', 'admission never destroys the producer value');
		assert.equal(layout.items.peek(0).fullText, hint.text);
	});

	test(`${variant} the smallest ellipsized status uses one actual glyph and withdraws below its minimum`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const input = [item('an indivisible original observation', 'right')];
		const markerWidth = font.measure(ELLIPSIS) + STATUS_ITEM_PADDING * 2;
		const bounds = { left: 14, top: 0, right: 14 + markerWidth, bottom: font.lineHeight };
		layout.update(input, bounds, font);
		const presentation = layout.items.peek(0);
		assert.equal(presentation.text, ELLIPSIS, 'the truncation representation is exactly the shared single glyph');
		assert.equal(presentation.visible, true); assert.equal(presentation.truncated, true);
		assert.equal(presentation.fullText, input[0].text);
		bounds.right--; layout.update(input, bounds, font);
		assert.equal(presentation.visible, false); assert.equal(layout.overflow, true);
		bounds.right = bounds.left; layout.update(input, bounds, font);
		assert.equal(presentation.visible, false);
	});

	test(`${variant} semantic error priority changes admission without destroying full values or future width`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const position = item('12:34', 'left'), installation = item('an installation observation', 'right', STATUS_PRIORITY_DETAIL);
		const input = [position, installation];
		const bounds = { left: 14, top: 0, right: 14 + font.measure(position.text) + STATUS_ITEM_PADDING * 2, bottom: font.lineHeight };
		layout.update(input, bounds, font);
		assert.equal(layout.items.peek(0).visible, true); assert.equal(layout.items.peek(1).visible, false);
		installation.priority = STATUS_PRIORITY_ERROR; installation.tone = 'error';
		assert.equal(layout.update(input, bounds, font), true);
		assert.equal(layout.items.peek(0).visible, false); assert.equal(layout.items.peek(1).visible, true);
		bounds.right = 640; layout.update(input, bounds, font);
		assert.equal(layout.overflow, false);
		for (let index = 0; index < input.length; index++) {
			assert.equal(layout.items.peek(index).text, input[index].text);
			assert.equal(layout.items.peek(index).truncated, false);
		}
	});

	test(`${variant} 180px status bounds every admitted item across source-like and Files-like observations`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		for (const input of [
			[item('1900 / 2300 : 132', 'left'), item('pending canonical source installation', 'right', STATUS_PRIORITY_DETAIL)],
			[item('project files', 'left'), item('optional filter keyboard gesture', 'right', STATUS_PRIORITY_HINT, 'hide')],
		]) {
			const bounds = { left: 14, top: 0, right: 180, bottom: font.lineHeight };
			layout.update(input, bounds, font);
			let visible = 0;
			for (const entry of layout.items) if (entry.visible) {
				visible++;
				assert.ok(entry.bounds.left >= bounds.left && entry.bounds.right <= bounds.right);
				assert.ok(font.measure(entry.text) <= entry.bounds.right - entry.bounds.left - STATUS_ITEM_PADDING * 2);
				assert.equal(entry.fullText, entry.item!.text);
			}
			assert.ok(visible > 0);
			const first = layout.items.peek(0), second = layout.items.peek(1);
			if (first.visible && second.visible) assert.ok(first.bounds.right <= second.bounds.left);
		}
	});

	test(`${variant} stable status queries retain presentations and perform no idle measurements`, t => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const input = [item('complete retained observation', 'left'), item('another retained fact', 'right', STATUS_PRIORITY_DETAIL)];
		const bounds = { left: 14, top: 0, right: 180, bottom: font.lineHeight };
		layout.update(input, bounds, font);
		const presentation = layout.items.peek(0), rectangle = presentation.bounds;
		const measure = t.mock.method(font, 'measure'), range = t.mock.method(font, 'measureTextRange');
		for (let frame = 0; frame < 1000; frame++) assert.equal(layout.update(input, bounds, font), false);
		assert.ok(layout.items.peek(0) === presentation && presentation.bounds === rectangle);
		assert.equal(measure.mock.callCount(), 0); assert.equal(range.mock.callCount(), 0);
		input[0].text = 'changed source observation';
		assert.equal(layout.update(input, bounds, font), true); assert.equal(presentation.fullText, input[0].text);
		input[1].priority = STATUS_PRIORITY_CONTENT + 1;
		assert.equal(layout.update(input, bounds, font), true);
		assert.equal(layout.update(input, bounds, font), false);
	});

	test(`${variant} overflow disclosure reserves one native slot without alternating idle measurement bounds`, t => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const input = [item('a retained observation that exceeds its actual native row allocation', 'left')];
		const bounds = { left: 14, top: 0, right: 180, bottom: font.lineHeight }, disclosureWidth = 24;
		layout.update(input, bounds, font, disclosureWidth);
		const presentation = layout.items.peek(0), disclosure = layout.disclosureBounds, rectangle = presentation.bounds;
		assert.equal(layout.overflow, true);
		assert.equal(disclosure.right - disclosure.left, disclosureWidth);
		assert.ok(rectangle.right <= disclosure.left); assert.deepEqual(layout.bounds, bounds);
		const measure = t.mock.method(font, 'measure'), range = t.mock.method(font, 'measureTextRange');
		for (let frame = 0; frame < 1000; frame++) assert.equal(layout.update(input, bounds, font, disclosureWidth), false);
		assert.equal(measure.mock.callCount(), 0); assert.equal(range.mock.callCount(), 0);
		assert.ok(layout.disclosureBounds === disclosure && presentation.bounds === rectangle);
		bounds.right = 1200; layout.update(input, bounds, font, disclosureWidth);
		assert.equal(layout.overflow, false); assert.equal(disclosure.left, disclosure.right);
		assert.equal(presentation.text, input[0].text); assert.deepEqual(layout.bounds, bounds);
	});

	test(`${variant} a context narrower than the native disclosure withdraws that whole control instead of clipping its icon`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const input = [item('a retained observation that cannot fit in a narrow native context', 'left')], disclosureWidth = 24;
		const bounds = { left: 14, top: 0, right: 14, bottom: font.lineHeight };
		for (const width of [0, 1, disclosureWidth - 1]) {
			bounds.right = bounds.left + width; layout.update(input, bounds, font, disclosureWidth);
			assert.equal(layout.overflow, true);
			assert.equal(layout.disclosureBounds.left, layout.disclosureBounds.right);
			for (const entry of layout.items) if (entry.visible) {
				assert.ok(entry.bounds.left >= bounds.left && entry.bounds.right <= bounds.right);
				assert.ok(font.measure(entry.text) + STATUS_ITEM_PADDING * 2 <= width);
			}
		}
		bounds.right = bounds.left + disclosureWidth; layout.update(input, bounds, font, disclosureWidth);
		assert.equal(layout.disclosureBounds.right - layout.disclosureBounds.left, disclosureWidth);
	});

	test(`${variant} multiline status keeps the exact raw observation independently of its bounded single-row projection`, () => {
		const font = new EditorFont(variant), layout = new WorkbenchStatusItemsLayout();
		const raw = 'first line\r\nsecond line\rthird line\nfourth\tvalue that extends beyond the native allocation';
		const source = item(raw, 'left');
		const bounds = { left: 14, top: 0, right: 180, bottom: font.lineHeight };
		layout.update([source], bounds, font, 24);
		const presentation = layout.items.peek(0);
		assert.equal(presentation.fullText, raw); assert.equal(source.text, raw);
		assert.equal(/[\r\n\t]/.test(presentation.text), false);
		assert.equal(presentation.truncated, true); assert.equal(layout.overflow, true);
		bounds.right = 1600; layout.update([source], bounds, font, 24);
		assert.equal(presentation.fullText, raw); assert.equal(presentation.text, raw.replace(/\r\n|[\r\n\t]/g, ' '));
	});

	test(`${variant} protected shell slots stay disjoint while feedback never changes the workspace height`, t => {
		configureFontVariant(variant); editorViewState.viewportHeight = 288;
		editorFeedbackState.message.visible = false;
		t.after(() => { editorFeedbackState.message.visible = false; });
		for (const width of [384, 180, 118, 35]) {
			editorViewState.viewportWidth = width; refreshWorkbenchLayout();
			const work = { ...getWorkbenchWorkArea() }, connection = getWorkbenchConnectionBounds();
			for (const guest of [false, true]) for (const failed of [false, true]) {
				const layout = getWorkbenchStatusLayout(guest, failed, 24);
				assert.ok(layout.hostFault.right <= layout.windowRestore.left && layout.windowRestore.right <= layout.context.left);
				assert.ok(layout.context.left <= layout.context.right && layout.context.right <= layout.guestHint.left);
				assert.ok(layout.guestHint.left <= layout.guestHint.right && layout.guestHint.right <= width);
				assert.ok(layout.connection === connection);
			}
			showEditorMessage('A complete multiline observation\nretains all of its source data without consuming another workspace row.', 'warning', 1);
			refreshWorkbenchLayout(); assert.deepEqual(getWorkbenchWorkArea(), work);
			updateEditorMessage(1); refreshWorkbenchLayout(); assert.deepEqual(getWorkbenchWorkArea(), work);
		}
	});
}
