import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
} from '../../ide/workbench/services/editor/resource_editor_resolver';

function resource(path: string, type: RuntimeResource['source']['type']): RuntimeResource {
	return {
		domain: 0,
		path,
		source: {
			resid: path,
			type,
			source_path: path,
		},
	};
}

test('resource editor resolution selects the first matching contribution without changing resource classification', () => {
	const visualEditor: ResourceEditorRegistration = {
		id: 'studio.behaviourTree',
		selector: { kind: 'filename_suffix', suffix: '.bt.jsonc' },
		open: () => {},
	};
	const textEditor: ResourceEditorRegistration = {
		id: 'workbench.text',
		selector: { kind: 'asset_type', assetType: 'lua' },
		open: () => {},
	};
	const resourceViewer: ResourceEditorRegistration = {
		id: 'workbench.viewer',
		selector: { kind: 'all' },
		open: () => {},
	};
	const resolver = new ResourceEditorResolver([
		visualEditor,
		textEditor,
		resourceViewer,
	]);
	const behaviourTree = resource('res/Enemy_Guard.BT.JSONC', 'data');

	assert.strictEqual(resolver.resolve(behaviourTree), visualEditor);
	assert.equal(behaviourTree.source.type, 'data');
	assert.strictEqual(resolver.resolve(resource('cart.lua', 'lua')), textEditor);
	assert.strictEqual(resolver.resolve(resource('sprite.png', 'image')), resourceViewer);
});

test('an explicit editor id selects another matching editor for the same resource', () => {
	const visualEditor: ResourceEditorRegistration = {
		id: 'studio.behaviourTree',
		selector: { kind: 'filename_suffix', suffix: '.bt.jsonc' },
		open: () => {},
	};
	const resourceViewer: ResourceEditorRegistration = {
		id: 'workbench.viewer',
		selector: { kind: 'all' },
		open: () => {},
	};
	const resolver = new ResourceEditorResolver([visualEditor, resourceViewer]);
	const behaviourTree = resource('res/enemy_guard.bt.jsonc', 'data');

	assert.strictEqual(resolver.resolve(behaviourTree), visualEditor);
	assert.strictEqual(resolver.resolve(behaviourTree, resourceViewer.id), resourceViewer);
	assert.throws(
		() => resolver.resolve(behaviourTree, 'missing.editor'),
		/No editor 'missing\.editor' is registered/,
	);
});
