import type { CodeTabContext, EditorTabDescriptor } from '../../common/types';

export type EditorSessionState = {
	codeTabContexts: Map<string, CodeTabContext>;
	activeCodeTabContextId: string;
	activeContextReadOnly: boolean;
	tabs: EditorTabDescriptor[];
	activeTabId: string;
	pendingResourceSelectionAssetId: string;
};

export const editorSessionState: EditorSessionState = {
	codeTabContexts: new Map<string, CodeTabContext>(),
	activeCodeTabContextId: null,
	activeContextReadOnly: false,
	tabs: [],
	activeTabId: null,
	pendingResourceSelectionAssetId: null,
};
