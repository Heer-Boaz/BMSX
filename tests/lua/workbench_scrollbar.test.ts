import { ScrollbarController } from '../../ide/editor/ui/scrollbar_controller';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';

for (const orientation of ['horizontal', 'vertical'] as const) {
	test(`${orientation} scrollbar maps thumb travel to the full content range and retains geometry`, () => {
		const bar = new Scrollbar(orientation);
		const track = orientation === 'horizontal' ? { left: 10, top: 110, right: 110, bottom: 113 } : { left: 110, top: 10, right: 113, bottom: 110 };
		bar.layout(track, 400, 100, 150);
		assert.equal(bar.isVisible(), true);
		const thumb = bar.getThumb()!;
		const start = () => orientation === 'horizontal' ? thumb.left : thumb.top;
		const end = () => orientation === 'horizontal' ? thumb.right : thumb.bottom;
		assert.equal(end() - start(), 25);
		assert.equal(start(), 47.5);
		const offset = bar.beginDrag(start() + 4);
		assert.equal(offset, 4);
		assert.equal(bar.drag(14, offset), 0);
		assert.equal(bar.drag(89, offset), 300);
		assert.equal(bar.drag(999, offset), 300);
		assert.equal(bar.drag(-100, offset), 0);
		const middleOffset = bar.beginDrag(60);
		assert.equal(bar.getScroll(), 150);
		assert.equal(middleOffset, 12.5);
		for (let index = 0; index < 100; index += 1) bar.layout(track, 400, 100, 150);
		assert.equal(bar.getThumb(), thumb);
		track[orientation === 'horizontal' ? 'top' : 'left'] += 10;
		assert.notDeepEqual(bar.getTrack(), track, 'layout owns its geometry, not the caller scratch rectangle');
		bar.layout(track, 400, 100, 150);
		assert.deepEqual(bar.getTrack(), track);
		bar.layout(track, 100000, 100, 99900);
		assert.equal(end() - start(), 6, 'large content keeps a grabbable tiny-viewport thumb');
		assert.equal(end(), 110);
	});
}

test('fitting content and a collapsed viewport have no draggable thumb', () => {
	const bar = new Scrollbar('vertical');
	const track = { left: 100, top: 0, right: 103, bottom: 100 };
	for (const content of [0, 30, 100]) {
		bar.layout(track, content, 100, 30);
		assert.equal(bar.isVisible(), false);
		assert.equal(bar.getThumb(), null);
		assert.equal(bar.getScroll(), 0);
	}
	bar.layout({ ...track, bottom: 0 }, 1000, 0, 0);
	assert.equal(bar.isVisible(), false);
	bar.layout({ ...track, bottom: 6 }, 1000, 6, 0);
	assert.equal(bar.isVisible(), false);
});

test('signed content coordinates stay at the range owner, including a changed minimum', () => {
	const bar = new Scrollbar('horizontal');
	const track = { left: 10, top: 100, right: 110, bottom: 103 };
	bar.layout(track, 400, 100, -50, -200);
	assert.equal(bar.getScroll(), -50);
	const thumb = bar.getThumb()!;
	assert.equal(thumb.left, 47.5);
	const offset = bar.beginDrag(thumb.left + 4);
	assert.equal(bar.drag(14, offset), -200);
	assert.equal(bar.drag(89, offset), 100);
	bar.layout(track, 400, 100, 100, -500);
	assert.equal(bar.getScroll(), -200, 'a new range clamps the existing logical coordinate');
	assert.equal(bar.getThumb(), thumb);
	assert.equal(thumb.right, track.right);
	bar.setScroll(-999);
	assert.equal(bar.getScroll(), -500);
	assert.equal(thumb.left, track.left);
	bar.layout(track, 30, 100, -480, -500);
	assert.equal(bar.isVisible(), false);
	assert.equal(bar.getScroll(), -500, 'fitting content retains its actual minimum, not synthetic zero');
});

test('editor scrollbar routing only hits the attached owner list, not another pane retained at the same coordinates', () => {
	const bars = {
		codeVertical: new Scrollbar('vertical'), codeHorizontal: new Scrollbar('horizontal'),
		resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal'), viewerVertical: new Scrollbar('vertical'),
	};
	const track = { left: 100, right: 103, top: 10, bottom: 110 };
	for (const bar of [bars.codeVertical, bars.resourceVertical, bars.viewerVertical]) bar.layout(track, 300, 100, 0);
	const applied: string[] = [];
	const controller = new ScrollbarController(bars, kind => applied.push(kind));
	assert.equal(controller.begin(['viewerVertical'], 101, 100, true, 3), true);
	controller.update(101, 70, true);
	assert.deepEqual(applied, ['viewerVertical', 'viewerVertical']);
	controller.cancel();
	assert.equal(bars.codeVertical.getScroll(), 0, 'hidden code geometry never steals the viewer press');
	assert.equal(controller.begin(['resourceVertical'], 101, 100, true, 3), true);
	assert.equal(applied.at(-1), 'resourceVertical');
});
