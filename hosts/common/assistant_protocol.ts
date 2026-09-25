/** Studio operations/events, not a tunnel for a provider's methods or configuration. */
export const STUDIO_ACCOUNT_LOGIN_URL = 'https://auth.openai.com/codex/device';
/**
 * How Studio authorizes an account. Loopback authorization is the ordinary path: the
 * browser returns the grant to a listener the account process owns, exactly as the Codex
 * CLI signs in. Device authorization is for a browser that cannot reach that listener,
 * which is every Studio opened from another machine on the LAN.
 */
export type AssistantLoginMethod = { type: 'loopback' } | { type: 'device-code' };
export type AssistantAccount = { connected: boolean; requiresLogin: boolean; email?: string; plan?: string };
/** Review observations at prompt submission, not source receipts or Save acknowledgements. */
export type AssistantReviewUpdate = {
	readonly review: string;
	readonly state: 'pending' | 'applying' | 'applied' | 'discarded' | 'stale' | 'failed';
	readonly reason: string;
};
export type AssistantThread = { id: string; title: string; updatedAt: number };
export type AssistantHistoryPage = { threads: AssistantThread[]; nextCursor: string | null };
export type AssistantHistoryEntry = { kind: 'user' | 'assistant' | 'status'; text: string };
export type AssistantTranscriptPage = { thread: AssistantThread; entries: AssistantHistoryEntry[]; nextCursor: string | null };
export type AssistantQueuedMessage = { id: string; text: string };
export type AssistantReply = { turnId: string } | AssistantHistoryPage | AssistantTranscriptPage;
/** Encoded host images are attachments, never JSON/base64 embedded in tool prose. */
export type AssistantToolResult = { success: boolean; text: string; images?: readonly string[] };
export type AssistantCommand =
	| { type: 'start'; prompt: string; reviews: readonly AssistantReviewUpdate[] }
	| { type: 'steer'; turnId: string; prompt: string; reviews: readonly AssistantReviewUpdate[] }
	| { type: 'queue'; prompt: string; reviews: readonly AssistantReviewUpdate[] }
	| { type: 'queue-update'; id: string; prompt: string }
	| { type: 'queue-delete'; id: string }
	| { type: 'queue-continue' }
	| { type: 'history'; cursor?: string; search?: string }
	| { type: 'open'; id: string }
	| { type: 'older'; cursor: string }
	| { type: 'new' }
	| { type: 'interrupt' }
	| { type: 'login-start'; method: AssistantLoginMethod }
	| { type: 'login-cancel' | 'sign-out' }
	| ({ type: 'tool-result'; requestId: string } & AssistantToolResult);
export type AssistantEvent =
	| { type: 'connected'; lease: string; account: AssistantAccount }
	| { type: 'thread'; thread: AssistantThread }
	| { type: 'queue'; messages: AssistantQueuedMessage[] }
	| { type: 'user-message'; turnId: string; itemId: string; text: string }
	| { type: 'turn-started'; turnId: string }
	| { type: 'turn-completed'; turnId: string; status: 'completed' | 'interrupted' | 'failed'; error?: string }
	| { type: 'text-delta' | 'message'; turnId: string; itemId: string; text: string }
	| { type: 'tool-request'; requestId: string; name: string; arguments: unknown }
	| { type: 'tool-cancelled'; requestId: string }
	| { type: 'account-refreshing' }
	| { type: 'account-changed'; account: AssistantAccount }
	// A device code is shown only when the browser cannot reach the loopback callback.
	| { type: 'login-started'; url: string; code?: string }
	// The host could not hand the address to a browser; the address stays in the transcript.
	| { type: 'login-open-failed'; error: string }
	| { type: 'login-completed'; success: boolean; error?: string }
	| { type: 'closed'; error?: string };

/** Platform capability supplied at Studio composition; no workbench imports of browser or Node owners. */
export interface AssistantConnection {
	readonly signal: AbortSignal;
	readonly closed: Promise<void>;
	readonly account: AssistantAccount;
	send(command: AssistantCommand): Promise<AssistantReply | undefined>;
	/** The URL is the one the process owner admitted, not a browser-side constant. */
	openLoginPage(url: string): void;
	close(error?: Error): void;
}
export type AssistantConnectionFactory = (signal: AbortSignal, onEvent: (event: AssistantEvent) => void) => Promise<AssistantConnection>;
