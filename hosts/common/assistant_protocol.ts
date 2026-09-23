/** Studio operations/events, not a tunnel for a provider's methods or configuration. */
export const STUDIO_ACCOUNT_LOGIN_URL = 'https://auth.openai.com/codex/device';
export type AssistantAccount = { connected: boolean; requiresLogin: boolean; email?: string; plan?: string };
export type AssistantCommand =
	| { type: 'start'; prompt: string }
	| { type: 'interrupt' }
	| { type: 'login-start' | 'login-cancel' | 'sign-out' }
	| { type: 'tool-result'; requestId: string; success: boolean; text: string };
export type AssistantEvent =
	| { type: 'connected'; lease: string; account: AssistantAccount }
	| { type: 'turn-started'; turnId: string }
	| { type: 'turn-completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed'; error?: string }
	| { type: 'text-delta' | 'message'; turnId: string; itemId: string; text: string }
	| { type: 'tool-request'; requestId: string; name: string; arguments: unknown }
	| { type: 'tool-cancelled'; requestId: string }
	| { type: 'account-refreshing' }
	| { type: 'account-changed'; account: AssistantAccount }
	| { type: 'login-started'; code: string }
	| { type: 'login-completed'; success: boolean; error?: string }
	| { type: 'closed'; error?: string };

/** Platform capability supplied at Studio composition; no workbench imports of browser or Node owners. */
export interface AssistantConnection {
	readonly signal: AbortSignal;
	readonly closed: Promise<void>;
	readonly account: AssistantAccount;
	send(command: AssistantCommand): Promise<{ turnId: string } | undefined>;
	openLoginPage(): void;
	close(error?: Error): void;
}
export type AssistantConnectionFactory = (signal: AbortSignal, onEvent: (event: AssistantEvent) => void) => Promise<AssistantConnection>;
