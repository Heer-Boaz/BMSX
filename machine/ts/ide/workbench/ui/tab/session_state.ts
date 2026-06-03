import type { EditorTabDescriptor } from '../../../common/models';

export type TabSessionState = {
	tabs: EditorTabDescriptor[];
	activeTabId: string;
};

export const tabSessionState: TabSessionState = {
	tabs: [],
	activeTabId: null,
};
