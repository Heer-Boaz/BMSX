import assert from 'node:assert/strict';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { measureText, measureTextRange } from '../../../ide/editor/common/text/layout';
import { InputFocusService } from '../../../ide/input/focus';
import { PointerCaptureService } from '../../../ide/input/pointer/capture';
import { PointerHoverService } from '../../../ide/input/pointer/hover';
import { WorkbenchPropertyInspector } from '../../../ide/workbench/ui/property_inspector/control';
import { medianMilliseconds } from '../../helpers/performance';

const FRAMES = 100000;
editorViewState.font = new EditorFont('tiny');
editorViewState.spaceAdvance = editorViewState.font.advance(' ');
const font = editorViewState.font.renderFont();
const bounds = { left: 0, top: 24, right: 384, bottom: 240 };
const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
const parent = focus.createTarget();
const inspector = new WorkbenchPropertyInspector(focus, capture, hover, parent);
let measured = 0;
const measure = (text: string, start: number, end: number) => {
	measured += 1;
	return measureTextRange(text, start, end);
};
for (const lines of [64, 1024, 4096]) {
	const value = Array.from({ length: lines }, (_, index) => `expected ${index}, actual ${index + 1}`).join('\n');
	const items = [{ label: 'FAILURE', value, description: 'TEST: independent.lua', warning: true }];
	const inspection = { title: 'RESULT', items, canOpenSource: () => false, openSource: () => assert.fail('no invented source') };
	const openMilliseconds = medianMilliseconds(() => {
		inspector.show(inspection);
		inspector.layout(font, measure, measureText, bounds);
	});
	const row = inspector.model.rows[0], before = measured;
	const warmed = medianMilliseconds(() => {
		for (let frame = 0; frame < FRAMES; frame += 1) {
			inspector.update();
			inspector.layout(font, measure, measureText, bounds);
		}
	});
	assert.equal(inspector.model.rows[0], row);
	assert.equal(measured, before, 'warmed updates neither reconstruct nor remeasure the output');
	console.log(JSON.stringify({ lines, bytes: value.length, openMilliseconds, warmedMicrosecondsPerFrame: warmed * 1000 / FRAMES }));
}
inspector.dispose();
