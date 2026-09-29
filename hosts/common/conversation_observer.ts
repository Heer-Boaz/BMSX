import type { AssistantConfiguration, AssistantHistoryPage, AssistantThread } from './assistant_protocol';

/** Read-only projection of a conversation owned by an external agent, not a second chat session. */
export type ObservedItem = { id: string; kind: 'user' | 'assistant' | 'status'; text: string; images?: readonly string[] };
export type ObservedConversationPage = { thread: AssistantThread; configuration: AssistantConfiguration;
	items: ObservedItem[]; nextCursor: string | null; working: boolean; mode: 'live' | 'saved' };
export type ConversationObserverCommand = { type: 'history'; cursor?: string; search?: string } | { type: 'open'; id: string } | { type: 'older' };
export type ConversationObserverEvent =
	| { type: 'connected'; lease: string }
	| { type: 'snapshot'; page: ObservedConversationPage }
	| { type: 'prepend'; items: ObservedItem[]; nextCursor: string | null }
	| { type: 'item'; item: ObservedItem }
	| { type: 'delta'; id: string; text: string }
	| { type: 'activity'; working: boolean; label: string }
	| { type: 'configuration'; configuration: AssistantConfiguration }
	| { type: 'title'; title: string }
	| { type: 'closed'; error: string };

export interface ConversationObserver {
	readonly signal: AbortSignal;
	send(command: ConversationObserverCommand): Promise<AssistantHistoryPage | undefined>;
	close(): void;
}
export type ConversationObserverFactory = (signal: AbortSignal, receive: (event: ConversationObserverEvent) => void) => Promise<ConversationObserver>;
