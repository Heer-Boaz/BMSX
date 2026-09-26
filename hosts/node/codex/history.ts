import type { AssistantHistoryEntry, AssistantHistoryPage, AssistantQueuedMessage, AssistantThread, AssistantTranscriptPage } from '../../common/assistant_protocol';
import type { CodexTextInput } from './input';
import { CodexAdmissionError, type CodexTool, type CodexTurn } from './protocol';
import type { CodexStdio } from './stdio';

type StoredThread = { id: string; name: string | null; preview: string; updatedAt: number };
type StoredItem =
	| { type: 'userMessage'; content: CodexTextInput[] }
	| { type: 'agentMessage'; text: string }
	| { type: 'dynamicToolCall'; tool: string; status: string }
	| { type: 'reasoning' | 'contextCompaction' };
type ThreadAdmission = { thread: StoredThread; cwd: string; approvalPolicy: string; sandbox: { type: string; networkAccess: boolean } };
type QueuedSubmission = { id: string; input: CodexTextInput[] };

/** Codex owns durable transcripts and queues. Browsing is metadata IO, never thread resumption or inference. */
export class CodexHistory {
	public selected: AssistantThread | undefined;
	public loaded = false;
	public constructor(private readonly rpc: CodexStdio, private readonly cwd: string, private readonly tools: readonly CodexTool[]) {}

	public async list(cursor?: string, search?: string): Promise<AssistantHistoryPage> {
		const page = await this.rpc.request<{ data: StoredThread[]; nextCursor: string | null }>('thread/list', {
			cursor, searchTerm: search, limit: 40, sortKey: 'updated_at', modelProviders: [],
		});
		return { threads: page.data.map(threadSummary), nextCursor: page.nextCursor };
	}

	public async read(id: string, cursor?: string): Promise<AssistantTranscriptPage> {
		const { thread } = await this.rpc.request<{ thread: StoredThread }>('thread/read', { threadId: id, includeTurns: false });
		const page = await this.rpc.request<{ data: (CodexTurn & { items: StoredItem[] })[]; nextCursor: string | null }>('thread/turns/list', {
			threadId: id, cursor, limit: 20, sortDirection: 'desc', itemsView: 'full',
		});
		const entries: AssistantHistoryEntry[] = [];
		for (const turn of page.data.reverse()) {
			for (const item of turn.items) {
				switch (item.type) {
					// Studio authors text-only inputs; review observations precede the unchanged user prompt.
					case 'userMessage': entries.push({ kind: 'user', text: item.content.at(-1)!.text }); break;
					case 'agentMessage': entries.push({ kind: 'assistant', text: item.text }); break;
					case 'dynamicToolCall': entries.push({ kind: 'status', text: `Historical tool: ${item.tool} (${item.status}). No active source/edit rights.` }); break;
					case 'contextCompaction': entries.push({ kind: 'status', text: 'Conversation context compacted by Codex.' }); break;
				}
			}
			entries.push({ kind: 'status', text: turn.status === 'failed' ? `Turn failed: ${turn.error!.message}` : `Turn ${turn.status}.` });
		}
		return { thread: threadSummary(thread), entries, nextCursor: page.nextCursor };
	}

	public async select(thread: AssistantThread | undefined): Promise<void> {
		if (this.loaded) await this.rpc.request('thread/unsubscribe', { threadId: this.selected!.id });
		this.loaded = false;
		this.selected = thread;
	}

	public async load(): Promise<AssistantThread> {
		if (this.loaded) return this.selected!;
		const admission = this.selected
			? await this.rpc.request<ThreadAdmission>('thread/resume', { threadId: this.selected.id,
				cwd: this.cwd, sandbox: 'danger-full-access', approvalPolicy: 'never', excludeTurns: true })
			: await this.rpc.request<ThreadAdmission>('thread/start', { cwd: this.cwd, sandbox: 'danger-full-access', approvalPolicy: 'never',
				ephemeral: false, environments: [], selectedCapabilityRoots: [],
				dynamicTools: this.tools.map(tool => ({ type: 'function', ...tool })) });
		if (admission.cwd !== this.cwd || admission.approvalPolicy !== 'never'
			|| admission.sandbox.type !== 'dangerFullAccess') {
			throw new CodexAdmissionError('Codex thread changed the admitted sandbox');
		}
		this.selected = threadSummary(admission.thread);
		this.loaded = true;
		return this.selected;
	}

	public async queue(id: string): Promise<AssistantQueuedMessage[]> {
		return (await this.readQueue(id)).map(item => ({ id: item.id, text: item.input.at(-1)!.text }));
	}

	public async updateQueued(threadId: string, id: string, prompt: string): Promise<void> {
		const item = (await this.readQueue(threadId)).find(item => item.id === id);
		if (!item) throw new Error('That queued message has already been dispatched or removed');
		// Editing the user prompt must not erase the review observations admitted
		// with it. Native update replaces a full input, not just its final text.
		item.input.at(-1)!.text = prompt;
		await this.rpc.request('thread/queue/update', { threadId, queuedSubmissionId: id, input: item.input });
	}

	private async readQueue(id: string): Promise<QueuedSubmission[]> {
		const messages: QueuedSubmission[] = [];
		let cursor: string | null = null;
		do {
			const page = await this.rpc.request<{ data: QueuedSubmission[]; nextCursor: string | null }>('thread/queue/list', {
				threadId: id, cursor,
			});
			messages.push(...page.data);
			cursor = page.nextCursor;
		} while (cursor !== null);
		return messages;
	}
}

function threadSummary(thread: StoredThread): AssistantThread {
	return { id: thread.id, title: thread.name === null ? thread.preview : thread.name, updatedAt: thread.updatedAt };
}
