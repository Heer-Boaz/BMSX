import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import {
	BehaviourTreeDocumentModelService,
} from '../../ide/workbench/contrib/behaviour_tree_editor/document_model';

const BLACKBOARD_ID = '10000000-0000-4000-8000-000000000001';
const ROOT_ID = '20000000-0000-4000-8000-000000000001';
const TASK_ID = '20000000-0000-4000-8000-000000000002';
const SERVICE_ID = '30000000-0000-4000-8000-000000000001';
const DECORATOR_ID = '40000000-0000-4000-8000-000000000001';

const SOURCE = `{
	// The visual editor must preserve this authored comment.
	"version": 1,
	"definition_id": "enemy.guard",
	"blackboard": [
		{
			"id": "${BLACKBOARD_ID}",
			"name": "alarm", // shared semantic key
			"initial_value": false,
		},
	],
	"root": {
		"id": "${ROOT_ID}",
		"type": "sequence",
		"services": [
			{
				"id": "${SERVICE_ID}",
				"binding": "sense",
			},
		],
		"children": [
			{
				"id": "${TASK_ID}",
				"type": "task",
				"binding": "patrol",
				"decorators": [
					{
						"id": "${DECORATOR_ID}",
						"type": "blackboard",
						"blackboard": "${BLACKBOARD_ID}",
						"operation": "equal",
						"value": false,
					},
				],
			},
		],
	},
}`;

function behaviourTreeResource(): RuntimeResource {
	return {
		domain: 0,
		path: 'res/data/enemy_guard.bt.jsonc',
		source: {
			resid: 'enemy_guard',
			type: 'data',
			source_path: 'res/data/enemy_guard.bt.jsonc',
			generated: false,
		},
	};
}

test('one retained behaviour-tree projection is shared by every view of a text model', () => {
	const textModel = new EditorTextModel(behaviourTreeResource(), 'behaviour_tree', SOURCE);
	const service = new BehaviourTreeDocumentModelService();
	const first = service.getOrCreate(textModel);
	const second = service.getOrCreate(textModel);
	const projection = first.projection;

	assert.strictEqual(second, first);
	assert.equal(projection.version, textModel.version);
	assert.equal(projection.document!.definition_id, 'enemy.guard');
	assert.equal(projection.elementsById.size, 5);
	assert.equal(projection.elementsById.get(BLACKBOARD_ID)!.kind, 'blackboard');
	assert.equal(projection.elementsById.get(ROOT_ID)!.kind, 'node');
	assert.equal(projection.elementsById.get(TASK_ID)!.kind, 'node');
	assert.equal(projection.elementsById.get(SERVICE_ID)!.kind, 'service');
	assert.equal(projection.elementsById.get(DECORATOR_ID)!.kind, 'decorator');
	assert.deepEqual(projection.elementsById.get(DECORATOR_ID)!.path, [
		'root',
		'children',
		0,
		'decorators',
		0,
	]);
	assert.strictEqual(first.projection, projection);
});

test('a structured property edit is one minimal text-model edit observed by source, projection, undo and redo', () => {
	const textModel = new EditorTextModel(behaviourTreeResource(), 'behaviour_tree', SOURCE);
	const documentModel = new BehaviourTreeDocumentModelService().getOrCreate(textModel);
	const originalLiteral = '"alarm"';
	const replacementLiteral = '"alert"';
	const literalOffset = SOURCE.indexOf(originalLiteral, SOURCE.indexOf('"name"'));
	const expected = SOURCE.slice(0, literalOffset)
		+ replacementLiteral
		+ SOURCE.slice(literalOffset + originalLiteral.length);
	const observedVersions: number[] = [];
	let projection = documentModel.projection;
	documentModel.onDidChangeProjection((next) => {
		projection = next;
		observedVersions.push(next.version);
	});

	assert.equal(documentModel.setBlackboardName(BLACKBOARD_ID, 'alert'), true);
	assert.equal(textModel.buffer.getText(), expected);
	assert.equal(textModel.version, 2);
	const editedProjection = projection;
	assert.equal(editedProjection.version, 2);
	assert.equal(editedProjection.blackboardById.get(BLACKBOARD_ID)!.value.name, 'alert');
	assert.match(textModel.buffer.getText(), /"name": "alert", \/\/ shared semantic key/);
	assert.equal(documentModel.setBlackboardName(BLACKBOARD_ID, 'alert'), false);
	assert.equal(textModel.version, 2);

	textModel.undo();
	assert.equal(textModel.buffer.getText(), SOURCE);
	const undoneProjection = projection;
	assert.equal(undoneProjection.version, 3);
	assert.equal(undoneProjection.blackboardById.get(BLACKBOARD_ID)!.value.name, 'alarm');
	textModel.redo();
	assert.equal(textModel.buffer.getText(), expected);
	const redoneProjection = projection;
	assert.equal(redoneProjection.version, 4);
	assert.equal(redoneProjection.blackboardById.get(BLACKBOARD_ID)!.value.name, 'alert');
	assert.deepEqual(observedVersions, [2, 3, 4]);
});

test('direct source edits rebuild the typed projection and expose invalid authored state', () => {
	const textModel = new EditorTextModel(behaviourTreeResource(), 'behaviour_tree', SOURCE);
	const documentModel = new BehaviourTreeDocumentModelService().getOrCreate(textModel);
	const definitionOffset = SOURCE.indexOf('enemy.guard');
	let projection = documentModel.projection;
	documentModel.onDidChangeProjection((next) => {
		projection = next;
	});

	textModel.pushEditOperations([{
		offset: definitionOffset,
		deleteLength: 'enemy.guard'.length,
		text: 'enemy.patrol',
	}]);
	assert.equal(projection.document!.definition_id, 'enemy.patrol');
	assert.equal(projection.elementsById.get(TASK_ID)!.kind, 'node');

	const currentSource = textModel.buffer.getText();
	const nameOffset = currentSource.indexOf('alarm', currentSource.indexOf('"name"'));
	textModel.pushEditOperations([{
		offset: nameOffset,
		deleteLength: 'alarm'.length,
		text: '',
	}]);
	assert.equal(projection.document, null);
	assert.equal(projection.diagnostics.some(diagnostic => (
		diagnostic.message === 'blackboard[0].name must not be empty.'
	)), true);

	textModel.undo();
	assert.equal(projection.document!.blackboard![0].name, 'alarm');
});
