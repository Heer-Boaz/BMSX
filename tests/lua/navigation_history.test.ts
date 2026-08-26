import assert from 'node:assert/strict';
import test from 'node:test';

import {
	initializeNavigationState,
	navigationState,
	takeBackwardNavigationEntry,
	takeForwardNavigationEntry,
	type NavigationHistoryEntry,
} from '../../ide/navigation/navigation_history';

function entry(path: string, row: number): NavigationHistoryEntry {
	return {
		contextId: `code:0:${path}`,
		domain: 0,
		path,
		row,
		column: 0,
	};
}

test('navigation history returns to the live cursor location after moving backward', () => {
	initializeNavigationState();
	const origin = entry('main.lua', 4);
	const liveDestination = entry('enemy.lua', 37);
	navigationState.back.push(origin);

	assert.deepEqual(takeBackwardNavigationEntry(liveDestination), origin);
	assert.deepEqual(navigationState.forward, [liveDestination]);
	assert.deepEqual(takeForwardNavigationEntry(origin), liveDestination);
	assert.deepEqual(navigationState.back, [origin]);
});
