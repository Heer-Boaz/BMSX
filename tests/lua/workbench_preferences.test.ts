import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkbenchPreferences } from '../../ide/workbench/services/preferences/preferences';
import { MemoryStorage } from '../../ide/workspace/memory_storage';

test('UI scale persists in frontend storage independently of project recovery and retires listeners', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.uiScale, 1);
	let changes = 0;
	const release = preferences.onDidChange(() => { changes++; });
	preferences.uiScale = 1.5; preferences.uiScale = 1.5;
	assert.equal(changes, 1);
	assert.equal(new WorkbenchPreferences(storage).uiScale, 1.5);
	assert.equal(new WorkbenchPreferences(new MemoryStorage()).uiScale, 1, 'an independent window has its own preference authority');
	release(); preferences.uiScale = 0.75;
	assert.equal(changes, 1);
	assert.equal(new WorkbenchPreferences(storage).uiScale, 0.75);
});
