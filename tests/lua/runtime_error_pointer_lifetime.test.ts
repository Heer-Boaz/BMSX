import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import test from 'node:test';
import { pointerHover } from '../../ide/input/pointer/hover';
import { setActiveRuntimeErrorOverlay, clearRuntimeErrorOverlay } from '../../ide/editor/contrib/runtime_error/navigation';
import type { RuntimeErrorOverlay } from '../../ide/editor/contrib/runtime_error/model';

function overlay(): RuntimeErrorOverlay {
	return { row: 0, column: 0, message: 'fixture', lines: [], messageLines: ['fixture'], lineDescriptors: [],
		layout: null, details: null, expanded: false, hovered: false, hoverLine: -1, copyButtonHovered: false, hidden: false };
}

test('runtime error retarget/clear revoke hover before replacing the active overlay', t => {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ sourceFilePath: 'error.lua', location: { kind: 'workspace', path: 'error.lua' }, domain: 0, path: 'error.lua', source: { type: 'lua', resid: 'error' } }, 'lua', 'return 1');
	const code = createTestCodeControl(t, model, documents, clock);
	const first = overlay(), second = overlay();
	setActiveRuntimeErrorOverlay(code, first);
	pointerHover.visit(code.runtimeErrorPointer);
	first.hovered = true; first.hoverLine = 0; first.copyButtonHovered = true;
	setActiveRuntimeErrorOverlay(code, first);
	assert.equal(first.hovered, true, 'same overlay publication does not pretend to leave');
	setActiveRuntimeErrorOverlay(code, second);
	assert.equal(first.hovered, false); assert.equal(first.hoverLine, -1); assert.equal(first.copyButtonHovered, false);
	pointerHover.visit(code.runtimeErrorPointer); second.hovered = true;
	clearRuntimeErrorOverlay(code); pointerHover.clear();
	assert.equal(second.hovered, false, 'no delayed callback may access the cleared active overlay');
});
