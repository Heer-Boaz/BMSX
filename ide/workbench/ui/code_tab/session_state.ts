import type { CodeTabContext } from './model';

export type CodeTabSessionState = {
	contexts: Map<string, CodeTabContext>;
	activeContextId: string;
};

export const codeTabSessionState: CodeTabSessionState = {
	contexts: new Map<string, CodeTabContext>(),
	activeContextId: null,
};
