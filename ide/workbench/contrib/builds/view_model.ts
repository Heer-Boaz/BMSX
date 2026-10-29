import type { IDisposable } from '../../../common/lifecycle';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchMenu } from '../../ui/menu/model';
import { WorkbenchTextViewModel } from '../../ui/text_view/model';
import { BUILD_LOG_TITLE_ACTIONS } from './menus';
import type { BuildOutput } from './output';

export type BuildLogChannel = 'output' | 'error';

/** One reader's channel, selection, search and layout over shared build documents. */
export class BuildLogViewModel implements IDisposable {
	public readonly output: WorkbenchTextViewModel;
	public error: WorkbenchTextViewModel | undefined;
	public readonly actions = createWorkbenchActionBar(new WorkbenchMenu(BUILD_LOG_TITLE_ACTIONS, this), true);
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public revision = 0;
	private channelValue: BuildLogChannel;
	private readonly unbind: () => void;
	private readonly documentListeners = new Set<(document: WorkbenchTextViewModel) => void>();

	public constructor(public readonly result: BuildOutput) {
		this.output = new WorkbenchTextViewModel(result.output);
		if (result.error !== undefined) this.error = new WorkbenchTextViewModel(result.error);
		this.channelValue = this.error === undefined ? 'output' : 'error';
		this.actions.menu!.refresh();
		this.actions.presentation.refresh();
		this.unbind = result.onDidChange(() => this.update());
	}

	public get channel(): BuildLogChannel { return this.channelValue; }
	public set channel(channel: BuildLogChannel) {
		if (channel === this.channelValue) return;
		this.channelValue = channel;
		this.revision++;
		for (const listener of this.documentListeners) listener(this.document);
	}
	public get document(): WorkbenchTextViewModel { return this.channelValue === 'error' ? this.error! : this.output; }
	public onDidChangeDocument(listener: (document: WorkbenchTextViewModel) => void): () => void {
		this.documentListeners.add(listener);
		return () => this.documentListeners.delete(listener);
	}

	private update(): void {
		const previousDocument = this.document;
		this.output.setBuffer(this.result.output);
		const hadError = this.error !== undefined;
		if (this.result.error === undefined) {
			this.error = undefined;
			this.channelValue = 'output';
		} else if (this.error === undefined) this.error = new WorkbenchTextViewModel(this.result.error);
		else this.error.setBuffer(this.result.error);
		this.revision++;
		if (previousDocument !== this.document) for (const listener of this.documentListeners) listener(this.document);
		if (hadError !== (this.error !== undefined)) {
			this.actions.menu!.refresh();
			this.actions.presentation.refresh();
		}
	}

	public dispose(): void { this.unbind(); this.documentListeners.clear(); }
}
