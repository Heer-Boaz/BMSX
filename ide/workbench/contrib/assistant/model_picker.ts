import type { AssistantModel, AssistantModelSelection } from '../../../../hosts/common/assistant_protocol';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { AssistantInput } from './editor_input';

/** Transient native-catalog choices; no permanent toolbar or model-generated suggestions. */
export class AssistantModelPicker {
	public async open(input: AssistantInput, kind: 'model' | 'effort' | 'fast', group: EditorGroupView, quickInput: QuickInputController): Promise<void> {
		if (input.commandPending) return;
		const conversation = input.conversation;
		if (!conversation.canBrowse) { conversation.notice('Stop the current operation before changing model settings.'); return; }
		const origin = input.draft.focusTarget;
		let retired = false;
		const unbind = origin.scope.onDidRetireContext(() => { retired = true; });
		input.commandPending = true;
		try {
			const { models } = await conversation.listModels();
			if (retired || input.lifetime.signal.aborted || group.model.activeTab !== input || !conversation.canBrowse) return;
			if (models.length === 0) { conversation.notice('No models are available for this account.'); return; }
			const current = models.find(model => model.id === conversation.configuration?.model);
			if (kind === 'model') {
				const items = models.map(model => ({ label: `${model.name}${model === current ? ' (current)' : model.isDefault ? ' (default)' : ''}`,
					description: model.description, detail: '', model }));
				quickInput.pick('Choose model', 'Select a model, then its reasoning effort', () => new TextQuickPickProvider(items, current ? models.indexOf(current) : 0),
					item => this.effort(input, item.model, group, quickInput), undefined, { invocationOrigin: origin, preserveFocus: !origin.hasFocus });
			} else if (!current) conversation.notice('Choose a catalog model with /model first.');
			else if (kind === 'effort') this.effort(input, current, group, quickInput);
			else this.fast(input, current, group, quickInput);
		} catch (error) { if (!retired && !input.lifetime.signal.aborted) conversation.notice(`Models unavailable: ${String(error)}`); }
		finally { input.commandPending = false; unbind(); }
	}

	private effort(input: AssistantInput, model: AssistantModel, group: EditorGroupView, quickInput: QuickInputController): void {
		const configuration = input.conversation.configuration;
		// Model changes do not silently opt into a faster, more expensive tier.
		const select = (effort: string) => this.apply(input, configuration?.model === model.id
			? { model: model.id, effort } : { model: model.id, effort, serviceTier: 'default' }, group);
		if (model.efforts.length === 0) { select(model.defaultEffort); return; }
		const items = model.efforts.map(option => ({ label: option.id, description: option.description,
			detail: configuration?.model === model.id && configuration.effort === option.id ? 'Current effort'
				: model.defaultEffort === option.id ? 'Model default' : '', effort: option.id }));
		const selected = model.efforts.findIndex(option => option.id === (configuration?.model === model.id && configuration.effort !== null
			? configuration.effort : model.defaultEffort));
		quickInput.pick(`${model.name}: reasoning effort`, 'Applies to subsequent turns; no model request', () => new TextQuickPickProvider(items, Math.max(0, selected)),
			item => select(item.effort), undefined, { invocationOrigin: input.draft.focusTarget, preserveFocus: !input.draft.focusTarget.hasFocus });
	}

	private fast(input: AssistantInput, model: AssistantModel, group: EditorGroupView, quickInput: QuickInputController): void {
		const tier = model.serviceTiers.find(tier => tier.name.toLowerCase() === 'fast');
		if (!tier) { input.conversation.notice(`${model.name} does not offer fast mode.`); return; }
		const configuration = input.conversation.configuration!;
		const items = [
			{ label: 'Normal speed', description: 'Fast off', detail: 'Standard service tier', tier: 'default' },
			{ label: tier.name, description: tier.description, detail: 'May consume your allowance faster', tier: tier.id },
		];
		quickInput.pick(`${model.name}: speed`, 'Choose explicitly; no model request', () => new TextQuickPickProvider(items, configuration.serviceTier === tier.id ? 1 : 0),
			item => this.apply(input, { model: model.id, serviceTier: item.tier }, group), undefined,
			{ invocationOrigin: input.draft.focusTarget, preserveFocus: !input.draft.focusTarget.hasFocus });
	}

	private apply(input: AssistantInput, selection: AssistantModelSelection, group: EditorGroupView): void {
		if (input.lifetime.signal.aborted || group.model.activeTab !== input) return;
		void input.conversation.configure(selection).catch(error => {
			if (!input.lifetime.signal.aborted) input.conversation.notice(`Model settings not changed: ${String(error)}`);
		});
	}
}
