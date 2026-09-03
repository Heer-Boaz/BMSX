import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
	type ResourceEditorSelector,
} from '../../ide/workbench/services/editor/resource_editor_resolver';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';

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

function registration(id: string, selector: ResourceEditorSelector): ResourceEditorRegistration {
	return {
		id,
		selector,
		createEditorInput: resource => {
			const input = new ResourceViewerInput({
				resource,
				lines: [],
				error: '',
				title: resource.path,
				scroll: 0,
			});
			input.title = id;
			return input;
		},
	};
}

test('resource editor resolution creates an input with the first matching contribution', async () => {
	const visualEditor = registration(
		'studio.behaviourTree',
		{ kind: 'filename_suffix', suffix: '.bt.jsonc' },
	);
	const textEditor = registration('workbench.text', { kind: 'asset_type', assetType: 'lua' });
	const resourceViewer = registration('workbench.viewer', { kind: 'all' });
	const resolver = new ResourceEditorResolver([
		visualEditor,
		textEditor,
		resourceViewer,
	]);
	const behaviourTree = resource('res/Enemy_Guard.BT.JSONC', 'data');

	assert.equal((await resolver.resolveEditorInput(behaviourTree)).title, visualEditor.id);
	assert.equal(behaviourTree.source.type, 'data');
	assert.equal((await resolver.resolveEditorInput(resource('cart.lua', 'lua'))).title, textEditor.id);
	assert.equal((await resolver.resolveEditorInput(resource('sprite.png', 'image'))).title, resourceViewer.id);
});

test('an explicit editor id creates another matching input for the same resource', async () => {
	const visualEditor = registration(
		'studio.behaviourTree',
		{ kind: 'filename_suffix', suffix: '.bt.jsonc' },
	);
	const resourceViewer = registration('workbench.viewer', { kind: 'all' });
	const resolver = new ResourceEditorResolver([visualEditor, resourceViewer]);
	const behaviourTree = resource('res/enemy_guard.bt.jsonc', 'data');

	assert.equal((await resolver.resolveEditorInput(behaviourTree)).title, visualEditor.id);
	assert.equal(
		(await resolver.resolveEditorInput(behaviourTree, resourceViewer.id)).title,
		resourceViewer.id,
	);
	assert.throws(
		() => resolver.resolveEditorInput(behaviourTree, 'missing.editor'),
		/No editor 'missing\.editor' is registered/,
	);
});
