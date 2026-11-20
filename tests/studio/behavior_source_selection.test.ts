import assert from 'node:assert/strict';
import test from 'node:test';
import { BehaviorSourceSelectionState } from '../../ide/workbench/contrib/behavior_lens/source_selection';

test('explicit Behavior selection A to B to A never revives captured A authority', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'A' });
	const captured = selection.selectionRevision;
	selection.select({ kind: 'node', rowKey: 'B' });
	assert.notEqual(selection.selectionRevision, captured);
	selection.select({ kind: 'node', rowKey: 'A' });
	assert.deepEqual(selection.selected, { kind: 'node', rowKey: 'A' });
	assert.notEqual(selection.selectionRevision, captured);
});

test('Behavior source correspondence rebinds definition and selected row keys without replacing their intent', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('old-definition');
	selection.select({ kind: 'node', rowKey: 'old-child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	// The source producer has proved the same mapped occurrences in the new generation.
	selection.reconcile('new-definition', { kind: 'node', rowKey: 'new-child' });
	assert.equal(selection.definitionRowKey, 'new-definition');
	assert.deepEqual(selection.selected, { kind: 'node', rowKey: 'new-child' });
	assert.equal(selection.definitionRevision, definition);
	assert.equal(selection.selectionRevision, selected);
});

test('Behavior selected-role loss retires only selected authority while its definition survives', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'tree-edge', rowKey: 'child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	selection.reconcile('definition', null);
	assert.equal(selection.selected, null);
	assert.equal(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
	selection.select({ kind: 'tree-edge', rowKey: 'child' });
	assert.notEqual(selection.selectionRevision, selected);
});

test('Behavior definition loss retires both authorities and explicit reselection cannot revive them', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	selection.reconcile(null, null);
	assert.equal(selection.definitionRowKey, null); assert.equal(selection.selected, null);
	assert.notEqual(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'child' });
	assert.notEqual(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
});

for (const operation of ['explicit', 'correspondence'] as const)
	test(`Behavior ${operation} node-to-edge role change supersedes a receipt for the same row key`, () => {
		const selection = new BehaviorSourceSelectionState();
		selection.selectDefinition('definition');
		selection.select({ kind: 'node', rowKey: 'child' });
		const definition = selection.definitionRevision, selected = selection.selectionRevision;
		if (operation === 'explicit') selection.select({ kind: 'tree-edge', rowKey: 'child' });
		else selection.reconcile('definition', { kind: 'tree-edge', rowKey: 'child' });
		assert.deepEqual(selection.selected, { kind: 'tree-edge', rowKey: 'child' });
		assert.equal(selection.definitionRevision, definition);
		assert.notEqual(selection.selectionRevision, selected);
	});

test('Behavior inner selection and explicit definition choice have distinct authority', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('first-definition');
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	selection.select({ kind: 'node', rowKey: 'first-child' });
	assert.equal(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
	const child = selection.selectionRevision;
	selection.selectDefinition('second-definition');
	assert.equal(selection.definitionRowKey, 'second-definition');
	assert.deepEqual(selection.selected, { kind: 'node', rowKey: 'second-definition' });
	assert.notEqual(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, child);
});

test('Behavior explicit restoration supersedes selected intent even when restoring the same occurrence', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	selection.restore('definition', { kind: 'node', rowKey: 'child' });
	assert.equal(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
});

test('Behavior no-op native selection preserves current intent rather than creating a new one', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	selection.select({ kind: 'node', rowKey: 'child' });
	assert.equal(selection.definitionRevision, definition);
	assert.equal(selection.selectionRevision, selected);
});

test('Behavior owner retirement ends definition and selected authority without reopening on restoration', () => {
	const selection = new BehaviorSourceSelectionState();
	selection.selectDefinition('definition');
	selection.select({ kind: 'node', rowKey: 'child' });
	const definition = selection.definitionRevision, selected = selection.selectionRevision;
	assert.equal(selection.available, true);
	selection.retire();
	assert.equal(selection.available, false);
	assert.notEqual(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
	selection.restore('definition', { kind: 'node', rowKey: 'child' });
	assert.equal(selection.available, false);
	assert.notEqual(selection.definitionRevision, definition);
	assert.notEqual(selection.selectionRevision, selected);
});
