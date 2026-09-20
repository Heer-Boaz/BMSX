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
			});
			input.title = id;
			return input;
		},
	};
}

test('resource editor resolution creates an input with the first matching contribution', async () => {
	const visualEditor = registration(
		'studio.timeline',
		{ kind: 'filename_suffix', suffix: '.timeline.yaml' },
	);
	const textEditor = registration('workbench.text', { kind: 'asset_type', assetType: 'lua' });
	const resourceViewer = registration('workbench.viewer', { kind: 'all' });
	const resolver = new ResourceEditorResolver([
		visualEditor,
		textEditor,
		resourceViewer,
	]);
	const timeline = resource('res/Intro.TIMELINE.YAML', 'data');

	assert.equal((await resolver.resolveEditorInput(timeline)).title, visualEditor.id);
	assert.equal(timeline.source.type, 'data');
	assert.equal((await resolver.resolveEditorInput(resource('cart.lua', 'lua'))).title, textEditor.id);
	assert.equal((await resolver.resolveEditorInput(resource('sprite.png', 'image'))).title, resourceViewer.id);
});

test('an explicit editor id creates another matching input for the same resource', async () => {
	const visualEditor = registration(
		'studio.timeline',
		{ kind: 'filename_suffix', suffix: '.timeline.yaml' },
	);
	const resourceViewer = registration('workbench.viewer', { kind: 'all' });
	const resolver = new ResourceEditorResolver([visualEditor, resourceViewer]);
	const timeline = resource('res/intro.timeline.yaml', 'data');

	assert.equal((await resolver.resolveEditorInput(timeline)).title, visualEditor.id);
	assert.equal(
		(await resolver.resolveEditorInput(timeline, resourceViewer.id)).title,
		resourceViewer.id,
	);
	assert.throws(
		() => resolver.resolveEditorInput(timeline, 'missing.editor'),
		/No editor 'missing\.editor' is registered/,
	);
});

test('filename suffix and asset type selectors must both match', async () => {
	const yamlEditor = registration('workbench.yaml', { kind: 'filename_suffix', suffix: '.yaml', assetType: 'data' });
	const viewer = registration('workbench.viewer', { kind: 'all' });
	const resolver = new ResourceEditorResolver([yamlEditor, viewer]);

	assert.equal((await resolver.resolveEditorInput(resource('res/room.YAML', 'data'))).title, yamlEditor.id);
	assert.equal((await resolver.resolveEditorInput(resource('res/room.json', 'data'))).title, viewer.id);
	assert.equal((await resolver.resolveEditorInput(resource('res/cue.aem.yaml', 'aem'))).title, viewer.id);
	assert.throws(() => resolver.resolveEditorInput(resource('res/cue.aem.yaml', 'aem'), yamlEditor.id), /No editor/);
});
