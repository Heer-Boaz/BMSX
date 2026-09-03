import assert from 'node:assert/strict';
import test from 'node:test';

import {
	initializeNavigationState,
	navigationState,
	takeBackwardNavigationEntry,
	takeForwardNavigationEntry,
	type NavigationHistoryEntry,
} from '../../ide/navigation/navigation_history';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import type { RuntimeResource } from '../../ide/common/resource';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import type { ResourcePanelController } from '../../ide/workbench/contrib/resources/panel/controller';
import { ResourceEditorResolver } from '../../ide/workbench/services/editor/resource_editor_resolver';
import { createTestEditorPanes } from '../helpers/editor_panes';

function entry(path: string, row: number): NavigationHistoryEntry {
	return {
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

test('history navigation awaits resource activation with its retained cursor location', async (t) => {
	initializeNavigationState();
	const target = entry('target.lua', 12);
	target.column = 7;
	const resource = {
		domain: 0,
		path: target.path,
		source: { type: 'lua' },
	} as RuntimeResource;
	editorTabGroup.initialize({
		id: 'resource:history',
		kind: 'resource_view',
		title: 'Resource',
		closable: true,
		resource: {
			resource,
			lines: [],
			error: '',
			title: 'Resource',
			scroll: 0,
		},
	});
	t.after(() => editorTabGroup.clear());
	navigationState.back.push(target);
	const sources = {
		resourceByIdentity: new Map([[`${target.domain}\0${target.path}`, resource]]),
	} as RuntimeSourceState;
	const navigation = new EditorNavigationController(
		sources,
		{} as ResourcePanelController,
		new ResourceEditorResolver([{
			id: 'test.editor',
			selector: { kind: 'all' },
			createEditorInput: () => editorTabGroup.activeTab,
		}]),
		createTestEditorPanes(),
	);
	let finishOpen: () => void;
	const openGate = new Promise<void>(resolve => {
		finishOpen = resolve;
	});
	let openedResource: RuntimeResource = null;
	let openedSelection: { row: number; startColumn: number; endColumn: number } = null;
	navigation.openResource = async (nextResource, selection) => {
		openedResource = nextResource;
		openedSelection = selection;
		await openGate;
	};

	const pending = navigation.goBackward();
	assert.equal(navigationState.captureSuspendDepth, 1);
	assert.strictEqual(openedResource, resource);
	assert.deepEqual(openedSelection, {
		row: target.row,
		startColumn: target.column,
		endColumn: target.column,
	});
	finishOpen!();
	await pending;
	assert.equal(navigationState.captureSuspendDepth, 0);
});
