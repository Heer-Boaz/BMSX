import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../ide/input/keyboard/key_input';
import type { CompletionContext, LuaCompletionItem } from '../ide/core/types';
import type { CompletionController } from '../ide/contrib/suggest/completion_controller';
import type { SymbolEntry } from './types';
import type {
	TerminalCompletionPanelState,
	TerminalSymbolPanelMode,
	TerminalSymbolPanelState,
	TerminalSymbolQueryContext,
} from './terminal_suggest_model';

export function handleInlineCompletionAccept(completion: CompletionController): boolean {
	if (!isKeyJustPressed('ArrowRight')) return false;
	const ctrlDown = isCtrlDown();
	const altDown = isAltDown();
	const metaDown = isMetaDown();
	if (ctrlDown || altDown || metaDown) return false;
	const accepted = completion.tryAcceptSelectedCompletion();
	if (!accepted) return false;
	consumeIdeKey('ArrowRight');
	return true;
}

type CompletionPanelTriggerDeps = {
	completion: CompletionController;
	openCompletionPanel: (context: CompletionContext, entries: LuaCompletionItem[], filtered: LuaCompletionItem[]) => void;
};

export function handleCompletionPanelTrigger(deps: CompletionPanelTriggerDeps): boolean {
	if (!isKeyJustPressed('Tab')) return false;
	const ctrlDown = isCtrlDown();
	const altDown = isAltDown();
	const metaDown = isMetaDown();
	if (ctrlDown || altDown || metaDown) return false;
	consumeIdeKey('Tab');
	const snapshot = deps.completion.listCompletionCandidates();
	if (!snapshot) return true;
	if (snapshot.filteredItems.length === 0) return true;
	deps.openCompletionPanel(snapshot.context, snapshot.items, snapshot.filteredItems);
	return true;
}

type CtrlTabTriggerDeps = {
	completion: CompletionController;
	openCompletionPanel: (context: CompletionContext, entries: LuaCompletionItem[], filtered: LuaCompletionItem[]) => void;
	resolveSymbolCompletionContext: () => TerminalSymbolQueryContext;
	buildSymbolCatalog: () => SymbolEntry[];
	filterSymbolEntries: (entries: SymbolEntry[], prefix: string) => SymbolEntry[];
	applySymbolCompletion: (context: TerminalSymbolQueryContext, name: string) => void;
	openSymbolPanel: (mode: TerminalSymbolPanelMode, entries: SymbolEntry[], filtered: SymbolEntry[], query: TerminalSymbolQueryContext | null) => void;
};

export function handleCtrlTabTrigger(deps: CtrlTabTriggerDeps): boolean {
	if (!isKeyJustPressed('Tab')) return false;
	const ctrlDown = isCtrlDown();
	const altDown = isAltDown();
	const metaDown = isMetaDown();
	if (!ctrlDown || altDown || metaDown) return false;
	consumeIdeKey('Tab');
	const completionSnapshot = deps.completion.listCompletionCandidates();
	if (completionSnapshot && completionSnapshot.context.kind === 'member' && completionSnapshot.filteredItems.length > 0) {
		deps.openCompletionPanel(completionSnapshot.context, completionSnapshot.items, completionSnapshot.filteredItems);
		return true;
	}
	const symbolContext = deps.resolveSymbolCompletionContext();
	const entries = deps.buildSymbolCatalog();
	const filtered = deps.filterSymbolEntries(entries, symbolContext.prefix);
	if (filtered.length === 0) return true;
	if (filtered.length === 1) {
		deps.applySymbolCompletion(symbolContext, filtered[0].name);
		return true;
	}
	deps.openSymbolPanel('complete', entries, filtered, symbolContext);
	return true;
}

type SymbolPanelKeyDeps = {
	panel: TerminalSymbolPanelState;
	closeSymbolPanel: (restoreInput: boolean) => void;
	moveSymbolSelectionRow: (delta: number) => void;
	moveSymbolSelectionColumn: (delta: number) => void;
	moveSymbolSelectionPage: (delta: number) => void;
	acceptSymbolPanelSelection: () => void;
	shouldRepeatKey: (code: string) => boolean;
};

export function handleSymbolPanelKeybindings(deps: SymbolPanelKeyDeps): boolean {
	if (!deps.panel) return false;
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		deps.closeSymbolPanel(true);
		return true;
	}
	if (isKeyJustPressed('Tab')) {
		consumeIdeKey('Tab');
		const shiftDown = isShiftDown();
		deps.moveSymbolSelectionRow(shiftDown ? -1 : 1);
		return true;
	}
	const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
	if (enterPressed) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		if (deps.panel.mode === 'complete') {
			deps.acceptSymbolPanelSelection();
		} else {
			deps.closeSymbolPanel(false);
		}
		return true;
	}
	const ctrlDown = isCtrlDown();
	const altDown = isAltDown();
	const metaDown = isMetaDown();
	if (ctrlDown || altDown || metaDown) return false;
	if (deps.shouldRepeatKey('ArrowDown')) { consumeIdeKey('ArrowDown'); deps.moveSymbolSelectionRow(1); return true; }
	if (deps.shouldRepeatKey('ArrowUp')) { consumeIdeKey('ArrowUp'); deps.moveSymbolSelectionRow(-1); return true; }
	if (deps.shouldRepeatKey('ArrowRight')) { consumeIdeKey('ArrowRight'); deps.moveSymbolSelectionColumn(1); return true; }
	if (deps.shouldRepeatKey('ArrowLeft')) { consumeIdeKey('ArrowLeft'); deps.moveSymbolSelectionColumn(-1); return true; }
	if (deps.shouldRepeatKey('PageDown')) { consumeIdeKey('PageDown'); deps.moveSymbolSelectionPage(1); return true; }
	if (deps.shouldRepeatKey('PageUp')) { consumeIdeKey('PageUp'); deps.moveSymbolSelectionPage(-1); return true; }
	return false;
}

type CompletionPanelKeyDeps = {
	panel: TerminalCompletionPanelState;
	closeCompletionPanel: (restoreInput: boolean) => void;
	moveCompletionSelectionRow: (delta: number) => void;
	moveCompletionSelectionColumn: (delta: number) => void;
	moveCompletionSelectionPage: (delta: number) => void;
	acceptCompletionPanelSelection: () => void;
	shouldRepeatKey: (code: string) => boolean;
};

export function handleCompletionPanelKeybindings(deps: CompletionPanelKeyDeps): boolean {
	if (!deps.panel) return false;
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		deps.closeCompletionPanel(false);
		return true;
	}
	if (isKeyJustPressed('Tab')) {
		consumeIdeKey('Tab');
		const shiftDown = isShiftDown();
		deps.moveCompletionSelectionRow(shiftDown ? -1 : 1);
		return true;
	}
	const enterPressed = isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter');
	if (enterPressed) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		deps.acceptCompletionPanelSelection();
		return true;
	}
	const ctrlDown = isCtrlDown();
	const altDown = isAltDown();
	const metaDown = isMetaDown();
	if (ctrlDown || altDown || metaDown) return false;
	if (deps.shouldRepeatKey('ArrowDown')) { consumeIdeKey('ArrowDown'); deps.moveCompletionSelectionRow(1); return true; }
	if (deps.shouldRepeatKey('ArrowUp')) { consumeIdeKey('ArrowUp'); deps.moveCompletionSelectionRow(-1); return true; }
	if (deps.shouldRepeatKey('ArrowRight')) { consumeIdeKey('ArrowRight'); deps.moveCompletionSelectionColumn(1); return true; }
	if (deps.shouldRepeatKey('ArrowLeft')) { consumeIdeKey('ArrowLeft'); deps.moveCompletionSelectionColumn(-1); return true; }
	if (deps.shouldRepeatKey('PageDown')) { consumeIdeKey('PageDown'); deps.moveCompletionSelectionPage(1); return true; }
	if (deps.shouldRepeatKey('PageUp')) { consumeIdeKey('PageUp'); deps.moveCompletionSelectionPage(-1); return true; }
	return false;
}
