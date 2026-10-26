import { extractErrorMessage } from '../../../common/errors';
import { showEditorMessage } from '../../../common/feedback_state';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { findEditorGroup, type EditorGroupView } from './editor_group';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { TextEditorInput } from '../../common/editor_input';
import type { EditorInput } from '../../ui/tab/model';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { ActionPrompt } from '../../contrib/modal/action_prompt';
import type { ActionPromptRequest } from '../../contrib/modal/action_prompt_view';
import type { TextFileSaveService } from '../working_copy/text_file_save';

export type EditorCloseTarget = { readonly group: EditorGroupView; readonly input: EditorInput };
export type CloseEditors = (targets: readonly EditorCloseTarget[], origin?: InputFocusTarget | null) => Promise<boolean>;

type DiscardIntent = { readonly version: number; readonly readOnly: boolean };

type CloseOperation = {
	readonly targets: readonly EditorCloseTarget[];
	readonly inputs: ReadonlySet<EditorInput>;
	readonly origin: InputFocusTarget | null;
	readonly lifetime: DisposableStore;
	readonly discards: Map<EditorTextModel, DiscardIntent>;
	readonly result: PromiseWithResolvers<boolean>;
	cancelled: boolean;
	prompt: ActionPromptRequest | undefined;
};

/** Workspace close admission owns decisions and writes; groups own the final view retirement. */
export class EditorCloseController {
	private readonly pending = new Map<EditorInput, CloseOperation>();
	private readonly operations = new Set<CloseOperation>();
	private disposed = false;
	private readonly unbindWorkspace: () => void;

	public constructor(private readonly groups: readonly EditorGroupView[],
		private readonly saves: TextFileSaveService, private readonly prompt: ActionPrompt, models: EditorTextModelService) {
		this.unbindWorkspace = models.onWillClear(() => {
			for (const operation of this.operations) this.cancel(operation);
		});
	}

	public readonly close: CloseEditors = (targets, origin = inputFocus.target) => {
		if (this.disposed) return Promise.resolve(false);
		const distinct: EditorCloseTarget[] = [];
		const inputs = new Set<EditorInput>();
		const waiting = new Set<CloseOperation>();
		for (const target of targets) {
			if (target.group.model.findById(target.input.id) !== target.input || !target.input.closable) return Promise.resolve(false);
			if (inputs.has(target.input)) continue;
			inputs.add(target.input);
			distinct.push(target);
			const pending = this.pending.get(target.input);
			if (pending !== undefined) waiting.add(pending);
		}
		if (waiting.size > 0) {
			if (waiting.size === 1) {
				const operation = waiting.values().next().value!;
				if (distinct.every(target => operation.inputs.has(target.input))) return operation.result.promise;
			}
			return Promise.all(Array.from(waiting, operation => operation.result.promise)).then(results => {
				if (results.some(closed => !closed)) return false;
				return this.close(distinct.filter(target => target.group.model.findById(target.input.id) === target.input), origin);
			});
		}
		const operation: CloseOperation = { targets: distinct, inputs, origin,
			lifetime: new DisposableStore(), discards: new Map(), result: Promise.withResolvers<boolean>(),
			cancelled: false, prompt: undefined };
		this.operations.add(operation);
		for (const target of distinct) {
			this.pending.set(target.input, operation);
			operation.lifetime.add({ dispose: target.group.onWillDispose(() => this.cancel(operation)) });
			operation.lifetime.add({ dispose: target.input.onWillDispose(() => this.cancel(operation)) });
		}
		void this.performClose(operation).then(closed => {
			this.finish(operation);
			operation.result.resolve(closed);
		}, error => {
			this.finish(operation);
			operation.result.reject(error);
		});
		return operation.result.promise;
	};

	public dispose(): void {
		this.disposed = true;
		this.unbindWorkspace();
		for (const operation of this.operations) this.cancel(operation);
	}

	/** Composite membership and other views are read again after every awaited decision or write. */
	private lastWorkingCopies(operation: CloseOperation): Set<EditorTextModel> {
		const models = new Set<EditorTextModel>();
		for (const { input } of operation.targets) if (input instanceof TextEditorInput) {
			for (const model of input.getWorkingCopies()) models.add(model);
		}
		for (const group of this.groups) for (const input of group.model.tabs) {
			if (operation.inputs.has(input) || !(input instanceof TextEditorInput)) continue;
			for (const model of input.getWorkingCopies()) models.delete(model);
		}
		return models;
	}

	private async performClose(operation: CloseOperation): Promise<boolean> {
		if (this.commitDraft(operation.targets, operation.origin) === 'failed') return false;
		if (operation.cancelled || operation.targets.some(target => target.group.model.findById(target.input.id) !== target.input)) return false;
		while (!operation.cancelled) {
			const models = this.lastWorkingCopies(operation);
			let undecided: EditorTextModel | undefined;
			for (const model of models) if (model.dirty) {
				const intent = operation.discards.get(model);
				if (intent === undefined || intent.version !== model.version || intent.readOnly !== model.readOnly) {
					undecided = model;
					break;
				}
			}
			if (undecided !== undefined) {
				// The root dialog will blur the currently focused control, including a sibling.
				const edit = inputFocus.target?.edit;
				if (edit?.pending === true) {
					if (!edit.commit()) return false;
					continue;
				}
				const model = undecided, version = model.version, readOnly = model.readOnly;
				const request: ActionPromptRequest = { title: 'Save changes?',
					message: sourceTabDescription(model.resource),
					primary: 'Save', secondary: 'Discard', primaryEnabled: !readOnly,
					defaultChoice: readOnly ? 'cancel' : 'primary' };
				operation.prompt = request;
				const choice = await this.prompt.show(request);
				operation.prompt = undefined;
				if (operation.cancelled || choice === 'cancel') return false;
				if (!this.lastWorkingCopies(operation).has(model) || !model.dirty) continue;
				if (model.version !== version || model.readOnly !== readOnly) continue;
				if (choice === 'primary') {
					const result = await this.saves.save(model).completion;
					if (operation.cancelled) return false;
					if (result.status === 'failed') {
						showEditorMessage(`Could not save ${sourceTabDescription(model.resource)}: ${extractErrorMessage(result.error)}`, 'error', 4);
						return false;
					}
				} else operation.discards.set(model, { version, readOnly });
				continue;
			}

			// Accepted writes finish before Discard or last-view retirement can change their baseline.
			let write: Promise<unknown> | undefined;
			for (const model of models) {
				const latest = this.saves.latestOperation(model);
				if (latest !== undefined && latest.result === undefined) { write = latest.completion; break; }
			}
			if (write !== undefined) { await write; continue; }

			const draft = this.commitDraft(operation.targets, operation.origin);
			if (draft === 'failed') return false;
			if (draft === 'committed') continue;
			let discarded = false;
			for (const model of models) if (model.dirty) {
				model.revert();
				operation.discards.delete(model);
				discarded = true;
				break;
			}
			if (discarded) continue;

			operation.lifetime.dispose();
			for (const { group, input } of operation.targets) {
				if (group.model.findById(input.id) === input) group.removeEditor(input);
			}
			return true;
		}
		return false;
	}

	private commitDraft(targets: readonly EditorCloseTarget[], origin: InputFocusTarget | null): 'none' | 'committed' | 'failed' {
		const focused = inputFocus.target;
		for (const target of [focused, origin]) {
			if (target?.edit?.pending !== true) continue;
			const group = findEditorGroup(target);
			if (!targets.some(view => view.group === group && view.input === group.model.activeTab)) continue;
			return target.edit.commit() ? 'committed' : 'failed';
		}
		return 'none';
	}

	private cancel(operation: CloseOperation): void {
		operation.cancelled = true;
		operation.lifetime.dispose();
		if (operation.prompt !== undefined) this.prompt.cancel(operation.prompt);
	}

	private finish(operation: CloseOperation): void {
		operation.lifetime.dispose();
		this.operations.delete(operation);
		for (const { input } of operation.targets) this.pending.delete(input);
	}
}
