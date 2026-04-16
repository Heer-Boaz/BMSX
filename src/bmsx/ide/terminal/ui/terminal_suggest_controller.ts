import type { CompletionController } from '../../editor/contrib/suggest/completion_controller';
import {
	handleCompletionPanelKeybindings as panelHandleCompletionPanelKeybindings,
	handleCompletionPanelTrigger as panelHandleCompletionPanelTrigger,
	handleCtrlTabTrigger as panelHandleCtrlTabTrigger,
	handleInlineCompletionAccept as panelHandleInlineCompletionAccept,
	handleSymbolPanelKeybindings as panelHandleSymbolPanelKeybindings,
} from './terminal_completion_panels_input';
import { TerminalSuggestModel } from '../common/terminal_suggest_model';

type TerminalSuggestControllerOptions = {
	completion: CompletionController;
	model: TerminalSuggestModel;
	shouldRepeatKey: (code: string) => boolean;
};

export class TerminalSuggestController {
	private readonly completion: CompletionController;
	private readonly model: TerminalSuggestModel;
	private readonly shouldRepeatKey: (code: string) => boolean;

	public constructor(options: TerminalSuggestControllerOptions) {
		this.completion = options.completion;
		this.model = options.model;
		this.shouldRepeatKey = options.shouldRepeatKey;
	}

	public handleInput(): boolean {
		const symbolPanel = this.model.symbolPanelState;
		if (symbolPanel) {
			return panelHandleSymbolPanelKeybindings({
				panel: symbolPanel,
				closeSymbolPanel: restoreInput => this.model.closeSymbolPanel(restoreInput),
				moveSymbolSelectionRow: delta => this.model.moveSymbolSelectionRow(delta),
				moveSymbolSelectionColumn: delta => this.model.moveSymbolSelectionColumn(delta),
				moveSymbolSelectionPage: delta => this.model.moveSymbolSelectionPage(delta),
				acceptSymbolPanelSelection: () => this.model.acceptSymbolPanelSelection(),
				shouldRepeatKey: code => this.shouldRepeatKey(code),
			});
		}
		const completionPanel = this.model.completionPanelState;
		if (completionPanel) {
			return panelHandleCompletionPanelKeybindings({
				panel: completionPanel,
				closeCompletionPanel: restoreInput => this.model.closeCompletionPanel(restoreInput),
				moveCompletionSelectionRow: delta => this.model.moveCompletionSelectionRow(delta),
				moveCompletionSelectionColumn: delta => this.model.moveCompletionSelectionColumn(delta),
				moveCompletionSelectionPage: delta => this.model.moveCompletionSelectionPage(delta),
				acceptCompletionPanelSelection: () => this.model.acceptCompletionPanelSelection(),
				shouldRepeatKey: code => this.shouldRepeatKey(code),
			});
		}
		if (panelHandleInlineCompletionAccept(this.completion)) {
			return true;
		}
		if (panelHandleCompletionPanelTrigger({
			completion: this.completion,
			openCompletionPanel: (context, entries, filtered) => this.model.openCompletionPanel(context, entries, filtered),
		})) {
			return true;
		}
		return panelHandleCtrlTabTrigger({
			completion: this.completion,
			openCompletionPanel: (context, entries, filtered) => this.model.openCompletionPanel(context, entries, filtered),
			resolveSymbolCompletionContext: () => this.model.resolveSymbolCompletionContext(),
			buildSymbolCatalog: () => this.model.buildSortedSymbolCatalog(),
			filterSymbolEntries: (entries, prefix) => this.model.filterSymbolEntries(entries, prefix),
			applySymbolCompletion: (context, name) => this.model.applySymbolCompletion(context, name),
			openSymbolPanel: (mode, entries, filtered, query) => this.model.openSymbolPanel(mode, entries, filtered, query),
		});
	}
}
