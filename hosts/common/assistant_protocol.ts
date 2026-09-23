/** Studio operations/events, not a tunnel for a provider's methods or configuration. */
export type AssistantAccount = { connected: boolean; requiresLogin: boolean; email?: string; plan?: string };
export type AssistantCommand =
	| { type: 'start'; prompt: string }
	| { type: 'interrupt' }
	| { type: 'tool-result'; requestId: string; success: boolean; text: string };
export type AssistantEvent =
	| { type: 'connected'; lease: string; account: AssistantAccount }
	| { type: 'turn-started'; turnId: string }
	| { type: 'turn-completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed'; error?: string }
	| { type: 'text-delta' | 'message'; turnId: string; itemId: string; text: string }
	| { type: 'tool-request'; requestId: string; name: string; arguments: unknown }
	| { type: 'tool-cancelled'; requestId: string }
	| { type: 'account-changed' }
	| { type: 'closed'; error?: string };
