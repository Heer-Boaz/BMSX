import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ensureResourcePanelSelectionScroll } from '../../ide/workbench/contrib/resources/panel/navigation';

test('resource panel scroll clamps once at the navigation owner', () => {
	assert.equal(ensureResourcePanelSelectionScroll(-1, 9, 4, 10), 6);
	assert.equal(ensureResourcePanelSelectionScroll(2, 9, 4, 10), 2);
	assert.equal(ensureResourcePanelSelectionScroll(8, 0, 4, 10), 5);
	assert.equal(ensureResourcePanelSelectionScroll(1, 0, 4, 10), 0);
});
