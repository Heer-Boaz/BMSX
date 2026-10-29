import { extractErrorMessage } from '../../../common/errors';
import { showEditorMessage } from '../../../common/feedback_state';
import { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { EditorTextModelService } from '../../../editor/model/model_service';
import { findEditorGroup, type EditorGroupView } from './editor_group';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { TextEditorInput } from '../../common/editor_input';
import type { EditorInput } from '../../common/editor_inputs';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { ActionPrompt } from '../../contrib/modal/action_prompt';
import type { ActionPromptRequest } from '../../contrib/modal/action_prompt_view';
import type { TextFileSaveService } from '../working_copy/text_file_save';

export type EditorCloseTarget = { readonly group: EditorGroupView; readonly input: EditorInput };
export type CloseEditors = (targets: readonly EditorCloseTarget[], origin?: InputFocusTarget | null, prompt?: ActionPrompt) => Promise<boolean>;

export interface WorkingCopyConsumer { getWorkingCopies(): readonly EditorTextModel[] }

/** A real retained context is retired by its composition owner inside final admission. */
export type WorkingCopyReleaseTarget = {
	readonly consumer: WorkingCopyConsumer;
	/** Incoming retention belongs to this replacement, not globally admitted UI membership. */
	readonly replacement?: WorkingCopyConsumer;
	readonly scope: InputFocusScope;
	isCurrent(): boolean;
	retire(): void;
};

type DiscardIntent = { readonly version: number; readonly readOnly: boolean };
const TRANSFER = Symbol('editor input transfer');

type CloseOperation = {
	readonly targets: readonly EditorCloseTarget[];
	readonly inputs: ReadonlySet<EditorInput>;
	readonly consumers: ReadonlySet<WorkingCopyConsumer>;
	readonly groups: ReadonlySet<EditorGroupView> | undefined;
	readonly release: WorkingCopyReleaseTarget | undefined;
	readonly origin: InputFocusTarget | null;
	readonly decisionUI: ActionPrompt;
	readonly predecessors: readonly Promise<boolean>[] | undefined;
	readonly lifetime: DisposableStore;
	readonly discards: Map<EditorTextModel, DiscardIntent>;
	readonly result: PromiseWithResolvers<boolean>;
	cancelled: boolean;
	prompt: ActionPromptRequest | undefined;
};

/** Workspace close admission owns decisions and writes; groups own the final view retirement. */
export class EditorCloseController {
	private readonly pending = new Map<EditorInput | WorkingCopyConsumer, CloseOperation | typeof TRANSFER>();
	private readonly operations = new Set<CloseOperation>();
	private disposed = false;
	private readonly unbindWorkspace: () => void;

	public constructor(private readonly getConsumers: () => Iterable<WorkingCopyConsumer>,
		private readonly saves: TextFileSaveService, private readonly prompt: ActionPrompt, models: EditorTextModelService) {
		this.unbindWorkspace = models.onWillClear(() => {
			for (const operation of [...this.operations]) this.cancel(operation);
		});
	}

	public isPending(input: EditorInput): boolean { return this.pending.has(input); }
	private readonly isClosing = (input: EditorInput): boolean => {
		const operation = this.pending.get(input);
		return operation !== undefined && operation !== TRANSFER;
	};

	/** Close and membership handoff share one input-operation admission boundary. */
	public transfer<T>(inputs: readonly EditorInput[], operation: () => T): T | false {
		if (this.disposed) return false;
		for (const input of inputs) if (this.pending.has(input)) return false;
		for (const input of inputs) this.pending.set(input, TRANSFER);
		try {
			return operation();
		} finally {
			for (const input of inputs) this.pending.delete(input);
		}
	}

	public readonly close: CloseEditors = (targets, origin = inputFocus.target, decisionUI = this.prompt) => {
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
			if (pending === TRANSFER) return Promise.resolve(false);
			if (pending !== undefined) waiting.add(pending);
		}
		if (waiting.size > 0) {
			if (waiting.size === 1) {
				const operation = waiting.values().next().value!;
				if (distinct.every(target => operation.inputs.has(target.input))) return operation.result.promise;
			}
		}
		// Already admitted closes keep their inputs; this request owns every uncovered
		// membership before waiting, rather than recapturing a later attachment.
		const owned = waiting.size === 0 ? distinct : distinct.filter(target => !this.pending.has(target.input));
		if (waiting.size !== 0) { inputs.clear(); for (const target of owned) inputs.add(target.input); }
		const consumers = new Set<WorkingCopyConsumer>();
		const groups = new Set<EditorGroupView>();
		for (const target of owned) {
			groups.add(target.group);
			if (target.input instanceof TextEditorInput) consumers.add(target.input);
		}
		const operation: CloseOperation = { targets: owned, inputs, consumers, groups, release: undefined, origin, decisionUI,
			predecessors: waiting.size === 0 ? undefined : Array.from(waiting, operation => operation.result.promise),
			lifetime: new DisposableStore(), discards: new Map(), result: Promise.withResolvers<boolean>(),
			cancelled: false, prompt: undefined };
		for (const group of groups) operation.lifetime.add({ dispose: group.onWillDispose(() => this.cancel(operation)) });
		for (const target of owned) operation.lifetime.add({ dispose: target.input.onWillDispose(() => this.cancel(operation)) });
		return this.start(operation);
	};

	/** Replacing or clearing a retained context uses the same final-consumer decision loop as tab close. */
	public release(target: WorkingCopyReleaseTarget, origin: InputFocusTarget | null = inputFocus.target,
		decisionUI: ActionPrompt = this.prompt): Promise<boolean> {
		if (this.disposed || !target.isCurrent()) return Promise.resolve(false);
		const pending = this.pending.get(target.consumer);
		if (pending === TRANSFER) return Promise.resolve(false);
		if (pending !== undefined) return pending.result.promise;
		const operation: CloseOperation = { targets: [], inputs: new Set(), consumers: new Set([target.consumer]), groups: undefined,
			release: target, origin, decisionUI, predecessors: undefined, lifetime: new DisposableStore(), discards: new Map(),
			result: Promise.withResolvers<boolean>(), cancelled: false, prompt: undefined };
		return this.start(operation);
	}

	/** A newer composition request revokes the old decision without waiting for its prompt or Save. */
	public cancelRelease(target: WorkingCopyReleaseTarget): void {
		const operation = this.pending.get(target.consumer);
		if (operation === undefined || operation === TRANSFER || operation.release !== target) return;
		this.pending.delete(target.consumer);
		this.cancel(operation);
	}

	private start(operation: CloseOperation): Promise<boolean> {
		this.operations.add(operation);
		for (const input of operation.inputs) this.pending.set(input, operation);
		if (operation.release !== undefined) this.pending.set(operation.release.consumer, operation);
		void this.performClose(operation).then(closed => {
			this.finish(operation);
			operation.result.resolve(closed);
		}, error => {
			this.finish(operation);
			operation.result.reject(error);
		});
		return operation.result.promise;
	}

	public dispose(): void {
		this.disposed = true;
		this.unbindWorkspace();
		for (const operation of this.operations) this.cancel(operation);
	}

	/** Composite membership and other views are read again after every awaited decision or write. */
	private lastWorkingCopies(operation: CloseOperation): Set<EditorTextModel> {
		const models = new Set<EditorTextModel>();
		for (const consumer of operation.consumers) for (const model of consumer.getWorkingCopies()) models.add(model);
		for (const consumer of this.getConsumers()) {
			if (operation.consumers.has(consumer)) continue;
			for (const model of consumer.getWorkingCopies()) models.delete(model);
		}
		const replacement = operation.release?.replacement;
		if (replacement !== undefined) for (const model of replacement.getWorkingCopies()) models.delete(model);
		return models;
	}

	private async performClose(operation: CloseOperation): Promise<boolean> {
		if (operation.predecessors !== undefined) {
			const closed = await Promise.all(operation.predecessors);
			if (operation.cancelled || closed.some(result => !result)) return false;
		}
		if (this.commitDraft(operation.targets, operation.origin, operation.release?.scope) === 'failed') return false;
		if (operation.cancelled || operation.targets.some(target => target.group.model.findById(target.input.id) !== target.input)) return false;
		while (!operation.cancelled) {
			if (operation.release?.isCurrent() === false) return false;
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
				// Only a workspace-wide dialog blurs unrelated clients. A local decision
				// cannot publish or be blocked by a sibling part's unsubmitted draft.
				if (operation.decisionUI.presentation.kind === 'workspace') {
					const edit = inputFocus.target?.edit;
					if (edit?.pending === true) {
						if (!edit.commit()) return false;
						continue;
					}
				}
				const model = undecided, version = model.version, readOnly = model.readOnly;
				const request: ActionPromptRequest = { title: 'Save changes?',
					message: sourceTabDescription(model.resource),
					primary: 'Save', secondary: 'Discard', primaryEnabled: !readOnly,
					defaultChoice: readOnly ? 'cancel' : 'primary' };
				operation.prompt = request;
				const choice = await operation.decisionUI.show(request, operation.origin);
				operation.prompt = undefined;
				if (operation.cancelled || operation.release?.isCurrent() === false || choice === 'cancel') return false;
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

			const draft = this.commitDraft(operation.targets, operation.origin, operation.release?.scope);
			if (draft === 'failed') return false;
			if (draft === 'committed') continue;
			if (operation.cancelled || operation.release?.isCurrent() === false) return false;
			let discarded = false;
			for (const model of models) if (model.dirty) {
				model.revert();
				operation.discards.delete(model);
				discarded = true;
				break;
			}
			if (discarded) continue;

			operation.lifetime.dispose();
			operation.release?.retire();
			for (const { group, input } of operation.targets) {
				if (group.model.findById(input.id) === input) group.removeEditor(input, this.isClosing);
			}
			return true;
		}
		return false;
	}

	private commitDraft(targets: readonly EditorCloseTarget[], origin: InputFocusTarget | null, scope?: InputFocusScope): 'none' | 'committed' | 'failed' {
		const focused = inputFocus.target;
		for (const target of [focused, origin]) {
			if (target?.edit?.pending !== true) continue;
			const group = findEditorGroup(target);
			if (scope?.contains(target.scope) !== true && !targets.some(view => view.group === group && view.input === group.model.activeTab)) continue;
			return target.edit.commit() ? 'committed' : 'failed';
		}
		return 'none';
	}

	private cancel(operation: CloseOperation): void {
		operation.cancelled = true;
		operation.lifetime.dispose();
		if (operation.prompt !== undefined) operation.decisionUI.cancel(operation.prompt);
	}

	private finish(operation: CloseOperation): void {
		operation.lifetime.dispose();
		this.operations.delete(operation);
		for (const input of operation.inputs) if (this.pending.get(input) === operation) this.pending.delete(input);
		const consumer = operation.release?.consumer;
		if (consumer !== undefined && this.pending.get(consumer) === operation) this.pending.delete(consumer);
		if (operation.groups !== undefined) for (const group of operation.groups) group.finishClose(this.isClosing);
	}
}
