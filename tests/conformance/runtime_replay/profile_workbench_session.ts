import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { medianMilliseconds } from '../../helpers/performance';
import { BT_TRANSFER_SOURCE } from '../../helpers/behavior_transfer_fixture';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { createCodeEditorViewState } from '../../../ide/editor/ui/code_editor_state';
import { CodeEditorInput } from '../../../ide/workbench/contrib/code_editor/editor_input';
import { BehaviorLensInput } from '../../../ide/workbench/contrib/behavior_lens/editor_input';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { selectBehaviorLensDefinition } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { EditorTabGroupModel } from '../../../ide/workbench/ui/tab/group_model';
import type { EditorInputSerializers } from '../../../ide/workbench/services/editor/editor_serialization';
import { CodeEditorInputSerializer } from '../../../ide/workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from '../../../ide/workbench/contrib/behavior_lens/editor_serializer';
import { SceneEditorInputSerializer } from '../../../ide/workbench/contrib/scene_editor/editor_serializer';
import { ScenarioLabInputSerializer } from '../../../ide/workbench/contrib/scenario_lab/editor_serializer';
import { ResourceViewerInputSerializer } from '../../../ide/workbench/contrib/resources/editor_serializer';

// Capture-only probe: real contribution serializers, no resolver, renderer, worker or storage IO.
// Run with node --expose-gc --import tsx --import ./tests/lua/test_setup.ts <this file>.
const serializers: EditorInputSerializers = {
	code_editor: new CodeEditorInputSerializer(null, null),
	behavior_lens: new BehaviorLensInputSerializer(null, null, null),
	scene_editor: new SceneEditorInputSerializer(null, null, null),
	scenario_lab: new ScenarioLabInputSerializer(null),
	resource_view: new ResourceViewerInputSerializer(null),
};
editorViewState.font = new EditorFont('tiny');
const source = BT_TRANSFER_SOURCE + '-- ' + 'source snapshot '.repeat(2048) + '\n';
for (const documents of [4, 32, 128]) {
	global.gc!();
	const heapBefore = process.memoryUsage().heapUsed;
	const group = new EditorTabGroupModel();
	let sourceReads = 0;
	const codeInputs: CodeEditorInput[] = [];
	for (let index = 0; index < documents; index += 1) {
		const resource = { domain: 0 as const, path: `workspace/definition_${index}.lua`, source: { type: 'lua' as const, resid: `definition_${index}` } };
		const model = new EditorTextModel(resource, 'lua', source);
		const readText = model.buffer.getText.bind(model.buffer);
		model.buffer.getText = () => { sourceReads += 1; return readText(); };
		const code = new CodeEditorInput({ id: `code:0\0${resource.path}`, title: resource.path, model,
			view: createCodeEditorViewState(), runtimeErrorOverlay: null, executionStopRow: null });
		codeInputs.push(code); group.add(code);
		const document = buildBehaviorSourceDocument(resource, buildLuaFileSemanticData(source, resource.path));
		for (const definition of document.definitions) {
			const view = createBehaviorLensViewState(document, model, 'graph', assert.fail);
			selectBehaviorLensDefinition(view, definition.rowKey);
			group.add(new BehaviorLensInput(model, view, () => assert.fail('capture must not create a graph worker')));
		}
	}
	group.activate(group.tabs[1]);
	const beforeCaptureReads = sourceReads;
	const coldStart = performance.now();
	let previous = group.serialize(serializers);
	const coldCaptureMilliseconds = performance.now() - coldStart;
	const snapshotReads = sourceReads - beforeCaptureReads;
	assert.equal(snapshotReads, documents, 'one fingerprint per working copy, not per view');
	const stableReads = sourceReads;
	const unchangedCaptureMicroseconds = medianMilliseconds(() => {
		for (let iteration = 0; iteration < 20; iteration += 1) assert.equal(group.serialize(serializers, previous), previous);
	}) * 50;
	const captureAndEncodeMicroseconds = medianMilliseconds(() => {
		for (let iteration = 0; iteration < 20; iteration += 1) {
			codeInputs[0].context.view.cursorColumn = iteration;
			const next = group.serialize(serializers, previous);
			assert.equal(next.inputs[1], previous.inputs[1], 'unchanged visual envelopes remain shared');
			JSON.stringify(next);
			previous = next;
		}
	}) * 50;
	assert.equal(sourceReads, stableReads, 'cursor checkpoints never reread source');
	global.gc!();
	console.log(JSON.stringify({ documents, inputs: group.tabs.length, sourceCharactersPerDocument: source.length,
		coldCaptureMilliseconds, snapshotReads, unchangedCaptureMicroseconds, captureAndEncodeMicroseconds,
		serializedCharacters: JSON.stringify(previous).length, retainedHeapBytes: process.memoryUsage().heapUsed - heapBefore,
		boundary: 'code and two BT inputs per working copy; capture + envelope JSON only; excludes IO, browser frames, raster, and total GC latency' }));
	group.clear();
}
