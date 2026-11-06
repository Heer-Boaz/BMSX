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

test('font sampling persists as a user preference without changing UI scale', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.fontSampling, 'linear');
	let changes = 0;
	const release = preferences.onDidChange(() => changes++);
	preferences.fontSampling = 'nearest'; preferences.fontSampling = 'nearest';
	assert.equal(changes, 1);
	assert.equal(new WorkbenchPreferences(storage).fontSampling, 'nearest');
	assert.equal(preferences.uiScale, 1);
	release(); preferences.fontSampling = 'linear';
	assert.equal(changes, 1);
});

test('scalable typography is the default and an explicit font choice persists in frontend storage', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.fontVariant, 'mono');
	let changes = 0;
	const release = preferences.onDidChange(() => changes++);
	preferences.fontVariant = 'tiny'; preferences.fontVariant = 'tiny';
	assert.equal(changes, 1);
	assert.equal(new WorkbenchPreferences(storage).fontVariant, 'tiny');
	assert.equal(new WorkbenchPreferences(new MemoryStorage()).fontVariant, 'mono');
	assert.equal(preferences.fontSampling, 'linear'); assert.equal(preferences.uiScale, 1);
	release(); preferences.fontVariant = 'mono';
	assert.equal(changes, 1);
});

test('font size is smaller by default for Mono and persists independently per family and from UI scale', () => {
	const storage = new MemoryStorage(), preferences = new WorkbenchPreferences(storage);
	assert.equal(preferences.fontScale, 0.75);
	let changes = 0;
	const release = preferences.onDidChange(() => changes++);
	preferences.fontScale = 0.5; preferences.fontScale = 0.5;
	assert.equal(changes, 1);
	preferences.fontVariant = 'tiny'; assert.equal(preferences.fontScale, 1);
	preferences.fontScale = 1.5;
	preferences.fontVariant = 'msx'; assert.equal(preferences.fontScale, 1);
	preferences.fontVariant = 'mono'; assert.equal(preferences.fontScale, 0.5);
	const restored = new WorkbenchPreferences(storage);
	assert.equal(restored.fontScale, 0.5);
	restored.fontVariant = 'tiny'; assert.equal(restored.fontScale, 1.5);
	assert.equal(preferences.uiScale, 1);
	release(); const before = changes; preferences.fontScale = 1;
	assert.equal(changes, before);
});
