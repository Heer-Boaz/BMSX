import type { AssistantConfiguration } from '../../common/assistant_protocol';
import type { ObservedItem, ObservedConversationPage } from '../../common/conversation_observer';

export type ObservedNativeThread = { id: string; name: string | null; preview: string; updatedAt: number;
	model: string | null; modelProvider: string; reasoningEffort: string | null; status: { type: string } };
type NativeInput = { type: 'text'; text: string } | { type: 'image'; url: string } | { type: 'image'; fileId: string }
	| { type: 'localImage' | 'localAudio'; path: string } | { type: 'audio'; url: string } | { type: 'skill' | 'mention'; name: string; path: string };
export type ObservedNativeItem =
	| { type: 'userMessage'; id: string; content: NativeInput[] }
	| { type: 'agentMessage' | 'plan'; id: string; text: string }
	| { type: 'reasoning'; id: string; summary: string[] }
	| { type: 'commandExecution'; id: string; command: string; status: string }
	| { type: 'mcpToolCall'; id: string; server: string; tool: string; status: string }
	| { type: 'dynamicToolCall' | 'collabAgentToolCall'; id: string; tool: string; status: string }
	| { type: 'fileChange'; id: string; changes: { path: string }[]; status: string }
	| { type: 'imageView'; id: string; path: string }
	| { type: 'contextCompaction'; id: string };
export type ObservedNativeTurn = { id: string; items: ObservedNativeItem[]; status: string; error: { message: string } | null };
export type ObservedNativePage = { data: ObservedNativeTurn[]; nextCursor: string | null };
export type ObservedNativeResume = { thread: ObservedNativeThread; model: string; modelProvider: string;
	reasoningEffort: string | null; serviceTier: string | null; initialTurnsPage: ObservedNativePage };

export function observedConfiguration(settings: { model: string | null; modelProvider: string; reasoningEffort: string | null; serviceTier: string | null }): AssistantConfiguration {
	return { agent: 'Codex', model: settings.model, provider: settings.modelProvider, effort: settings.reasoningEffort, serviceTier: settings.serviceTier };
}
export function observedItemId(turn: string, item: string): string { return `item:${turn}:${item}`; }

/** Provider media is not a filesystem capability. Local attachments remain named references. */
export function observedItem(turn: string, item: ObservedNativeItem): ObservedItem | undefined {
	const id = observedItemId(turn, item.id);
	switch (item.type) {
		case 'userMessage': {
			const texts: string[] = [], images: string[] = [];
			for (const part of item.content) switch (part.type) {
				case 'text': texts.push(part.text); break;
				case 'image': if ('url' in part) images.push(part.url); else texts.push(`Image: ${part.fileId}`); break;
				case 'localImage': texts.push(`Image: ${part.path}`); break;
				case 'localAudio': texts.push(`Audio: ${part.path}`); break;
				case 'audio': texts.push('Audio attachment'); break;
				case 'skill': case 'mention': texts.push(`@${part.name} (${part.path})`); break;
			}
			return { id, kind: 'user', text: texts.join('\n\n'), images };
		}
		case 'agentMessage': case 'plan': return { id, kind: 'assistant', text: item.text };
		case 'reasoning': return undefined; // Activity, not a request for private reasoning content.
		case 'commandExecution': return { id, kind: 'status', text: `${item.status}: ${item.command}` };
		case 'mcpToolCall': return { id, kind: 'status', text: `${item.server}.${item.tool} (${item.status})` };
		case 'dynamicToolCall': case 'collabAgentToolCall': return { id, kind: 'status', text: `${item.tool} (${item.status})` };
		case 'fileChange': return { id, kind: 'status', text: `${item.status}: ${item.changes.map(change => change.path).join(', ')}` };
		case 'imageView': return { id, kind: 'status', text: `Viewed image: ${item.path}` };
		case 'contextCompaction': return { id, kind: 'status', text: 'Conversation context compacted by Codex.' };
	}
}
export function observedTurnStatus(turn: ObservedNativeTurn): ObservedItem | undefined {
	if (turn.status === 'failed' || turn.status === 'interrupted') return {
		id: `turn:${turn.id}`, kind: 'status', text: turn.status === 'failed' ? `Turn failed: ${turn.error!.message}` : 'Turn interrupted.',
	};
}
export function observedPageItems(page: ObservedNativePage): ObservedItem[] {
	const items: ObservedItem[] = [];
	for (let index = page.data.length - 1; index >= 0; index--) {
		const turn = page.data[index];
		for (const item of turn.items) { const entry = observedItem(turn.id, item); if (entry) items.push(entry); }
		const status = observedTurnStatus(turn); if (status) items.push(status);
	}
	return items;
}
export function observedSnapshot(response: ObservedNativeResume): ObservedConversationPage {
	const { thread } = response;
	return { thread: { id: thread.id, title: thread.name === null ? thread.preview : thread.name, updatedAt: thread.updatedAt },
		configuration: observedConfiguration(response), items: observedPageItems(response.initialTurnsPage), nextCursor: response.initialTurnsPage.nextCursor,
		working: thread.status.type === 'active', mode: 'live' };
}
