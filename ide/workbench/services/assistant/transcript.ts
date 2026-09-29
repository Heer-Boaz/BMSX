import type { AssistantSourceReference } from '../../../../hosts/common/assistant_protocol';
import { PieceTreeBuffer } from '../../../editor/text/piece_tree_buffer';
import type { WorkspaceEditProposal } from '../working_copy/workspace_edit';

export type AssistantEntry = {
	readonly kind: 'user' | 'assistant' | 'status' | 'proposal';
	readonly text: PieceTreeBuffer;
	index: number;
	readonly proposal?: WorkspaceEditProposal;
	readonly references?: readonly AssistantSourceReference[];
	readonly images?: readonly string[];
	resetRevision: number;
};
type ConversationChange = 'state' | 'text' | 'proposal' | 'reset' | 'prepend';

/** Retained conversation text. Layout, connections and source authority have separate owners. */
export class AssistantTranscript {
	public readonly entries: AssistantEntry[] = [];
	public revision = 0;
	protected readonly listeners = new Set<(entry: number, kind: ConversationChange) => void>();

	public onDidChange(listener: (entry: number, kind: ConversationChange) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	protected changed(entry = this.entries.length, kind: ConversationChange = 'state'): void {
		this.revision++;
		for (const listener of this.listeners) listener(entry, kind);
	}
	protected append(kind: AssistantEntry['kind'], text: string, proposal?: WorkspaceEditProposal, references?: readonly AssistantSourceReference[], images?: readonly string[]): AssistantEntry {
		const entry = { kind, text: new PieceTreeBuffer(text), index: this.entries.length, resetRevision: 0, proposal, references, images };
		// Settlement drains the observer; workspace clear disposes every pending proposal.
		proposal?.onDidSettle(() => this.changed(entry.index, 'proposal'));
		this.entries.push(entry); this.changed(entry.index, 'text'); return entry;
	}

	protected resetTranscript(): void {
		for (const entry of this.entries) entry.proposal?.dispose();
		this.entries.length = 0; this.changed(0, 'reset');
	}
}
