import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import {
	ResourceEditorResolver,
	type ResourceEditorRegistration,
	type ResourceEditorSelector,
} from '../../ide/workbench/services/editor/resource_editor_resolver';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { createResourceEditorResolver } from '../../ide/workbench/contrib/resources/editor_contributions';
import { CartMapInput, WORKBENCH_CART_MAP_EDITOR_ID } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { AemEditorInput, WORKBENCH_AEM_EDITOR_ID } from '../../ide/workbench/contrib/aem/editor_input';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorInput } from '../../ide/workbench/ui/tab/model';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function resource(path: string, type: RuntimeResource['source']['type']): RuntimeResource {
	return { contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
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
			const input = new ResourceViewerInput(createScenarioTestSourceState([]).catalog, resource);
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

for (const [path, kind, source] of [
	['res/data/castle_map.yaml', 'pietious', '1: { map: [".."], objects: [] }\n'],
	['res/data/castle_map.yml', 'pietious', '1: { map: [".."], objects: [] }\n'],
	['res/data/nemesis_s_stage.yaml', 'nemesis', 'map_rows: ["m "]\n'],
	['res/data/nemesis_s_stage.yml', 'nemesis', 'map_rows: ["m "]\n'],
] as const) test(`built-in ${path} resolution selects Map while explicit Source shares its canonical working copy`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const sources = createScenarioTestSourceState([]), inputs: EditorInput[] = [];
	t.after(async () => {
		for (const input of inputs) input.dispose();
		editorTextModelService.clear(); clearWorkspaceSourceCaches(); sources.catalog.dispose(); await closeWorkspaceRecords();
	});
	const identity = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path };
	sources.catalog.registerTextSources(identity.contextId, [{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: source } }]);
	const resource = sources.catalog.resolveResource(identity)!, resolver = createResourceEditorResolver(sources.catalog);
	const first = await resolver.resolveEditorInput(resource); inputs.push(first);
	const second = await resolver.resolveEditorInput(resource); inputs.push(second);
	const text = await resolver.resolveEditorInput(resource, WORKBENCH_TEXT_EDITOR_ID); inputs.push(text);
	assert.ok(first instanceof CartMapInput && second instanceof CartMapInput);
	assert.equal(resolver.getEditorId(resource), WORKBENCH_CART_MAP_EDITOR_ID);
	assert.equal(first.mapKind, kind); assert.equal(second.mapKind, kind);
	assert.ok(text instanceof CodeEditorInput);
	assert.ok(first.workingCopy === second.workingCopy && text.workingCopy === first.workingCopy);
	assert.ok(first.workingCopy === editorTextModelService.get(identity));
	assert.ok(first.resource === resource && text.resource === resource);
	assert.equal(first.workingCopy.mode, 'yaml');
	assert.equal(first.workingCopy.buffer.getText(), source); assert.equal(first.workingCopy.dirty, false);
});

test('built-in generic YAML remains Source and Audio Event Maps retain their own default and explicit Source views', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const sources = createScenarioTestSourceState([]), inputs: EditorInput[] = [];
	t.after(async () => {
		for (const input of inputs) input.dispose();
		editorTextModelService.clear(); clearWorkspaceSourceCaches(); sources.catalog.dispose(); await closeWorkspaceRecords();
	});
	sources.catalog.registerTextSources(TEST_CARTRIDGE_CONTEXT_IDS[0], [
		{ type: 'data', resid: 'settings', source_path: 'res/data/settings.yaml', sourcemeta: { text: '# canonical settings\nvalue: 3\n' } },
		{ type: 'aem', resid: 'events', source_path: 'res/data/events.aem.yaml', sourcemeta: { text: 'events: {}\n' } },
	]);
	const resolver = createResourceEditorResolver(sources.catalog);
	const yaml = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/data/settings.yaml' })!;
	const aem = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'res/data/events.aem.yaml' })!;
	const yamlView = await resolver.resolveEditorInput(yaml); inputs.push(yamlView);
	const aemView = await resolver.resolveEditorInput(aem); inputs.push(aemView);
	const aemSource = await resolver.resolveEditorInput(aem, WORKBENCH_TEXT_EDITOR_ID); inputs.push(aemSource);
	assert.ok(yamlView instanceof CodeEditorInput && aemView instanceof AemEditorInput && aemSource instanceof CodeEditorInput);
	assert.equal(resolver.getEditorId(yaml), WORKBENCH_TEXT_EDITOR_ID); assert.equal(resolver.getEditorId(aem), WORKBENCH_AEM_EDITOR_ID);
	assert.ok(aemView.workingCopy === aemSource.workingCopy && aemView.workingCopy === editorTextModelService.get(aem));
	assert.equal(yamlView.workingCopy.buffer.getText(), '# canonical settings\nvalue: 3\n');
	assert.equal(aemView.workingCopy.buffer.getText(), 'events: {}\n');
});
