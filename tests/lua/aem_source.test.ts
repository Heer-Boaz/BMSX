import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { RuntimeResource } from '../../ide/common/resource';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createStructuredValueEdit } from '../../ide/language/yaml/structured_edits';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { projectAemSource } from '../../ide/workbench/contrib/aem/source';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { resolveWorkspacePath } from '../../ide/workspace/path';

const documents = [
	{ format: 'yaml', source: '# authored event map\nevents:\n  story:\n    channel: "music" # retain this comment\n    rules:\n      - go:\n          audio_id: "theme"\n  impact:\n    channel: "sfx"\n    rules: []\n' },
	{ format: 'json', source: '{\n  "events": {\n    "story": { "channel": "music", "rules": [{ "go": { "audio_id": "theme" } }] },\n    "impact": { "channel": "sfx", "rules": [] }\n  }\n}\n' },
] as const;

function fixture(t: TestContext, format: 'yaml' | 'json', source: string) {
	const path = `res/audio/events.aem.${format}`;
	const resource: RuntimeResource = { contextLabel: 'Fixture project', sourceFilePath: resolveWorkspacePath(path, 'carts/test'), contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, location: { kind: 'project', projectRootPath: 'carts/test', path },
		source: { type: 'aem', resid: 'events', source_path: path } };
	const model = new EditorTextModel(resource, 'aem', source), input = new AemEditorInput(model);
	t.after(() => { input.dispose(); model.dispose(); });
	projectAemSource(input);
	return { resource, model, input };
}

for (const { format, source } of documents) {
	test(`AEM ${format} presentation does not publish parser paths or offsets as property descriptions`, t => {
		const { input } = fixture(t, format, source);
		assert.ok(input.tree.rows.length > 0);
		assert.ok(input.tree.rows.every(row => row.element.description === ''), 'source bindings are commands data, not permanent help text');
	});

	test(`AEM ${format} collection disclosure carries hierarchy while only actual empty containers publish a value`, t => {
		const { input } = fixture(t, format, source);
		for (const path of [[], ['events'], ['events', 'story'], ['events', 'story', 'rules']] as const)
			assert.equal(input.tree.rows.find(row => row.element.key === JSON.stringify(path))!.element.value, '', 'a nonempty collection does not duplicate its children with a count summary');
		assert.equal(input.tree.rows.find(row => row.element.key === JSON.stringify(['events', 'impact', 'rules']))!.element.value, '[]');
		const empty = fixture(t, format, '{}').input;
		assert.equal(empty.tree.roots[0].element.value, '{}');
	});

	test(`AEM ${format} projection retains canonical resource and authored AST bindings without rebuilding an unchanged generation`, t => {
		const { resource, model, input } = fixture(t, format, source);
		assert.ok(input.resource === resource && input.workingCopy === model);
		assert.equal(input.id, `aem:${resourceIdentityKey(resource)}`);
		assert.equal(input.source, source); assert.equal(model.buffer.getText(), source);
		const root = input.tree.roots[0].element;
		assert.deepEqual(root.path, []); assert.equal(root.key, JSON.stringify([]));
		assert.ok(root.node === input.document!.contents); assert.equal(root.parent, undefined); assert.equal(root.index, undefined);
		for (const binding of [
			{ path: ['events', 'story', 'channel'], parent: ['events', 'story'], index: 0 },
			{ path: ['events', 'story', 'rules', 0], parent: ['events', 'story', 'rules'], index: 0 },
			{ path: ['events', 'story', 'rules', 0, 'go', 'audio_id'], parent: ['events', 'story', 'rules', 0, 'go'], index: 0 },
		] as const) {
			const property = input.tree.rows.find(row => row.element.key === JSON.stringify(binding.path))!.element;
			assert.deepEqual(property.path, binding.path);
			assert.ok(property.node === input.document!.getIn(binding.path, true));
			assert.ok(property.parent === input.document!.getIn(binding.parent, true)); assert.equal(property.index, binding.index);
			if (property.inlineEditable) assert.equal(property.value, source.slice(property.node.range![0], property.node.range![1]));
		}
		for (const lexeme of ['"music"', '"theme"']) {
			const property = input.tree.rows.find(row => row.element.value === lexeme)!.element, start = source.indexOf(lexeme);
			assert.deepEqual(property.node.range!.slice(0, 2), [start, start + lexeme.length], 'property ranges identify the exact authored scalar token');
		}
		const document = input.document, rows = [...input.tree.rows]; input.tree.textDirty = false;
		projectAemSource(input);
		assert.ok(input.document === document); assert.equal(input.tree.rows.length, rows.length);
		assert.ok(input.tree.rows.every((row, index) => row === rows[index])); assert.equal(input.tree.textDirty, false);
	});

	test(`AEM ${format} source edits and Undo retain selection and collapse by semantic path`, t => {
		const { model, input } = fixture(t, format, source);
		const selected = JSON.stringify(['events', 'story', 'channel']), collapsed = JSON.stringify(['events', 'impact']);
		input.tree.selectionIndex = input.tree.rows.findIndex(row => row.element.key === selected);
		setWorkbenchTreeCollapsed(input.tree, input.tree.rows.findIndex(row => row.element.key === collapsed), true);
		const property = input.tree.rows[input.tree.selectionIndex].element, range = property.node.range!;
		model.pushEditOperations([createStructuredValueEdit(source, format, property.node, '"audiofx"')]); projectAemSource(input);
		assert.equal(model.buffer.getText(), source.slice(0, range[0]) + '"audiofx"' + source.slice(range[1]));
		assert.equal(input.tree.rows[input.tree.selectionIndex].element.key, selected);
		assert.equal(input.tree.rows.find(row => row.element.key === collapsed)!.collapsed, true);
		model.undo(); projectAemSource(input);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canRedo, true);
		assert.equal(input.tree.rows[input.tree.selectionIndex].element.key, selected);
		assert.equal(input.tree.rows.find(row => row.element.key === collapsed)!.collapsed, true);
	});

	test(`AEM ${format} parser failure has a diagnostic and successful recovery has no permanent status instruction`, t => {
		const { model, input } = fixture(t, format, source);
		model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: format === 'yaml' ? 'events: [\n' : '{"events":' }]);
		projectAemSource(input);
		assert.equal(input.document, undefined); assert.equal(input.tree.rows.length, 0); assert.equal(input.tree.selectionIndex, -1);
		assert.ok(input.status.length > 0, 'the parser failure remains available as an actual diagnostic');
		model.undo(); projectAemSource(input);
		assert.equal(model.buffer.getText(), source); assert.ok(input.document !== undefined && input.tree.rows.length > 0);
		assert.equal(input.status, '', 'successful authoring does not reserve status space for a fixed Save instruction');
	});
}
