import type { AssistantModel, AssistantModels, AssistantModelSelection } from '../../common/assistant_protocol';
import type { CodexStdio } from './stdio';

type CodexModel = { model: string; displayName: string; description: string; hidden: boolean; isDefault: boolean;
	supportedReasoningEfforts: { reasoningEffort: string; description: string }[]; defaultReasoningEffort: string;
	serviceTiers: { id: string; name: string; description: string }[] };

/** Native catalog per account lifetime. Opening pickers never starts inference or creates a thread. */
export class CodexModels {
	private catalog: Promise<AssistantModels> | undefined;
	public constructor(private readonly rpc: Pick<CodexStdio, 'request'>) {}
	public clear(): void { this.catalog = undefined; }
	public list(): Promise<AssistantModels> {
		if (this.catalog) return this.catalog;
		const pending = this.read();
		this.catalog = pending;
		void pending.catch(() => { if (this.catalog === pending) this.catalog = undefined; });
		return pending;
	}
	private async read(): Promise<AssistantModels> {
		const models: AssistantModel[] = [];
		let cursor: string | null = null;
		do {
			const page = await this.rpc.request<{ data: CodexModel[]; nextCursor: string | null }>('model/list', { cursor, limit: 100, includeHidden: false });
			for (const model of page.data) {
				if (model.hidden) continue;
				models.push({ id: model.model, name: model.displayName, description: model.description, isDefault: model.isDefault,
					efforts: model.supportedReasoningEfforts.map(option => ({ id: option.reasoningEffort, description: option.description })),
					defaultEffort: model.defaultReasoningEffort, serviceTiers: model.serviceTiers });
			}
			cursor = page.nextCursor;
		} while (cursor !== null);
		return { models };
	}

	/** Browser selections cross the process authority boundary; only catalog choices are admitted. */
	public async admit(selection: AssistantModelSelection): Promise<void> {
		const model = (await this.list()).models.find(model => model.id === selection.model);
		if (!model) throw new Error('That model is not in the current account catalog');
		if (selection.effort !== undefined && !model.efforts.some(effort => effort.id === selection.effort) && selection.effort !== model.defaultEffort) {
			throw new Error('That reasoning effort is not supported by the selected model');
		}
		if (selection.serviceTier !== undefined && selection.serviceTier !== null && selection.serviceTier !== 'default' && !model.serviceTiers.some(tier => tier.id === selection.serviceTier)) {
			throw new Error('That service tier is not supported by the selected model');
		}
	}
}
