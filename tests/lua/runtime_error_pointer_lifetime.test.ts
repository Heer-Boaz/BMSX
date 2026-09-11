import assert from 'node:assert/strict';
import test from 'node:test';
import { pointerHover } from '../../ide/input/pointer/hover';
import { runtimeErrorOverlayPointer } from '../../ide/editor/contrib/runtime_error/pointer';
import { setActiveRuntimeErrorOverlay, clearRuntimeErrorOverlay } from '../../ide/editor/contrib/runtime_error/navigation';
import type { RuntimeErrorOverlay } from '../../ide/editor/contrib/runtime_error/model';

function overlay(): RuntimeErrorOverlay {
	return { row: 0, column: 0, message: 'fixture', lines: [], messageLines: ['fixture'], lineDescriptors: [],
		layout: null, details: null, expanded: false, hovered: false, hoverLine: -1, copyButtonHovered: false, hidden: false };
}

test('runtime error retarget/clear revoke hover before replacing the active overlay', () => {
	const first = overlay(), second = overlay();
	setActiveRuntimeErrorOverlay(first);
	pointerHover.visit(runtimeErrorOverlayPointer);
	first.hovered = true; first.hoverLine = 0; first.copyButtonHovered = true;
	setActiveRuntimeErrorOverlay(first);
	assert.equal(first.hovered, true, 'same overlay publication does not pretend to leave');
	setActiveRuntimeErrorOverlay(second);
	assert.equal(first.hovered, false); assert.equal(first.hoverLine, -1); assert.equal(first.copyButtonHovered, false);
	pointerHover.visit(runtimeErrorOverlayPointer); second.hovered = true;
	clearRuntimeErrorOverlay(); pointerHover.clear();
	assert.equal(second.hovered, false, 'no delayed callback may access the cleared active overlay');
});
