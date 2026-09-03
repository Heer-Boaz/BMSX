import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayerInput } from '../../hosts/common/input/player';
import type { PointerSnapshot } from '../../ide/common/models';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { EditorPane } from '../../ide/workbench/services/editor/editor_pane';
import { EditorPanes } from '../../ide/workbench/services/editor/editor_panes';
import type {
	BehaviorLensInput,
	EditorInput,
	ScenarioLabInput,
} from '../../ide/workbench/ui/tab/model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';

class RecordingEditorPane<TInput extends EditorInput> extends EditorPane<TInput> {
	public setInputCount = 0;
	public setOptionsCount = 0;
	public clearInputCount = 0;
	public updateCount = 0;
	public drawCount = 0;
	public keyboardCount = 0;
	public pointerCount = 0;
	public wheelCount = 0;
	public statusCount = 0;
	public selection: EditorTextSelection | undefined;

	public override setInput(input: TInput, selection?: EditorTextSelection): void {
		this.setInputCount += 1;
		super.setInput(input, selection);
	}

	public override setOptions(selection?: EditorTextSelection): void {
		this.setOptionsCount += 1;
		super.setOptions(selection);
	}

	public override clearInput(): void {
		this.clearInputCount += 1;
		super.clearInput();
	}

	protected activate(selection?: EditorTextSelection): void {
		this.selection = selection;
	}

	public override update(): void {
		this.updateCount += 1;
	}

	public draw(): void {
		this.drawCount += 1;
	}

	public handleKeyboard(_playerInput: PlayerInput): void {
		this.keyboardCount += 1;
	}

	public handlePointer(
		_snapshot: PointerSnapshot,
		_justPressed: boolean,
		_pointerSecondaryJustPressed: boolean,
		_playerInput: PlayerInput,
		_now: number,
		_gotoModifierActive: boolean,
	): void {
		this.pointerCount += 1;
	}

	public handleWheel(
		_direction: number,
		_steps: number,
		_activePointer: PointerSnapshot | null,
		_playerInput: PlayerInput,
	): void {
		this.wheelCount += 1;
	}

	public drawStatusBar(_statusTop: number, _textColor: number): void {
		this.statusCount += 1;
	}
}

function codeInput(id: 'code:0\0a.lua' | 'code:0\0b.lua'): CodeEditorInput {
	const path = id.slice('code:0\0'.length);
	const context: CodeTabContext = {
		id,
		title: id,
		model: new EditorTextModel({
			domain: 0,
			path,
			source: { resid: path, type: 'lua' },
		}, 'lua', ''),
		view: createCodeEditorViewState(),
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};
	return new CodeEditorInput(context);
}

function resourceInput(): ResourceViewerInput {
	return new ResourceViewerInput({
		resource: { domain: 0, path: 'image.png' },
		title: 'image.png',
	} as ResourceViewerInput['resource']);
}

function createEditorPanes() {
	let codePane: RecordingEditorPane<CodeEditorInput>;
	let resourcePane: RecordingEditorPane<ResourceViewerInput>;
	let codeFactoryCount = 0;
	let resourceFactoryCount = 0;
	const editorPanes = new EditorPanes({
		code_editor: () => {
			codeFactoryCount += 1;
			codePane = new RecordingEditorPane<CodeEditorInput>();
			return codePane;
		},
		resource_view: () => {
			resourceFactoryCount += 1;
			resourcePane = new RecordingEditorPane<ResourceViewerInput>();
			return resourcePane;
		},
		behavior_lens: () => new RecordingEditorPane<BehaviorLensInput>(),
		scenario_lab: () => new RecordingEditorPane<ScenarioLabInput>(),
	});
	return {
		editorPanes,
		codePane: () => codePane!,
		resourcePane: () => resourcePane!,
		codeFactoryCount: () => codeFactoryCount,
		resourceFactoryCount: () => resourceFactoryCount,
	};
}

test('editor panes retain one lazy pane per input kind and apply the input lifecycle', () => {
	const harness = createEditorPanes();
	const first = codeInput('code:0\0a.lua');
	const second = codeInput('code:0\0b.lua');
	const selection = { row: 7, startColumn: 2, endColumn: 5 };
	const codeClearInputCounts: number[] = [];

	assert.equal(harness.codeFactoryCount(), 0);
	assert.equal(harness.resourceFactoryCount(), 0);
	harness.editorPanes.openEditor(first);
	const codePane = harness.codePane();
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(codePane.setInputCount, 1);

	harness.editorPanes.openEditor(first, selection);
	assert.equal(codePane.setOptionsCount, 1);
	assert.strictEqual(codePane.selection, selection);

	harness.editorPanes.openEditor(second);
	assert.equal(harness.codeFactoryCount(), 1);
	// disable-next-line repeated_expression_pattern -- Successive reads prove the clearInput transition count after each lifecycle operation.
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(codePane.setInputCount, 2);
	assert.strictEqual(codePane.input, second);

	harness.editorPanes.openEditor(resourceInput());
	const resourcePane = harness.resourcePane();
	assert.equal(harness.resourceFactoryCount(), 1);
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.equal(resourcePane.setInputCount, 1);

	harness.editorPanes.openEditor(first);
	assert.equal(harness.codeFactoryCount(), 1);
	assert.equal(resourcePane.clearInputCount, 1);
	assert.equal(codePane.setInputCount, 3);

	harness.editorPanes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	harness.editorPanes.clearEditor();
	codeClearInputCounts.push(codePane.clearInputCount);
	assert.deepEqual(codeClearInputCounts, [1, 2, 3, 3]);
});

test('editor pane hot paths dispatch directly to the retained active pane', () => {
	const harness = createEditorPanes();
	const playerInput = {} as PlayerInput;
	const snapshot = {} as PointerSnapshot;
	harness.editorPanes.openEditor(resourceInput());

	const activePane = harness.editorPanes.activePane;
	activePane.update(0.02);
	activePane.draw();
	activePane.handleKeyboard(playerInput);
	activePane.handlePointer(snapshot, true, false, playerInput, 42, false);
	activePane.handleWheel(1, 3, snapshot, playerInput);
	activePane.drawStatusBar(280, 0xffffffff);

	const pane = harness.resourcePane();
	assert.equal(pane.updateCount, 1);
	assert.equal(pane.drawCount, 1);
	assert.equal(pane.keyboardCount, 1);
	assert.equal(pane.pointerCount, 1);
	assert.equal(pane.wheelCount, 1);
	assert.equal(pane.statusCount, 1);
	assert.equal(harness.resourceFactoryCount(), 1);
});
