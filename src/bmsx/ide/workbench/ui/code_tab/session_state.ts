import type { CodeTabContext } from '../../../common/models';

export type CodeTabSessionState = {
	contexts: Map<string, CodeTabContext>;
	activeContextId: string;
	activeContextReadOnly: boolean;
};

export const codeTabSessionState: CodeTabSessionState = {
	contexts: new Map<string, CodeTabContext>(),
	activeContextId: null,
	activeContextReadOnly: false,
};
