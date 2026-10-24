import type { AssistantEntry } from '../../services/assistant/transcript';
import type { WorkspaceEditProposal } from '../../services/working_copy/workspace_edit';

/** One retained transcript target: a message or an image-array slot in that exact entry. */
export class AssistantTranscriptSelection {
	private entryValue: AssistantEntry | undefined;
	private imageIndexValue: number | undefined;
	private readonly targetListeners = new Set<() => void>();
	private readonly proposalListeners = new Set<() => void>();

	public get entry(): AssistantEntry | undefined { return this.entryValue; }
	public get imageIndex(): number | undefined { return this.imageIndexValue; }
	public get proposal(): WorkspaceEditProposal | undefined {
		return this.imageIndexValue === undefined && this.entryValue?.kind === 'proposal' ? this.entryValue.proposal : undefined;
	}

	public onWillChangeTarget(listener: () => void): () => void {
		this.targetListeners.add(listener);
		return () => this.targetListeners.delete(listener);
	}
	public onWillChangeProposal(listener: () => void): () => void {
		this.proposalListeners.add(listener);
		return () => this.proposalListeners.delete(listener);
	}

	/** Selecting an image-only entry starts at its first image, never an invisible empty message. */
	public select(entry: AssistantEntry | undefined, imageIndex?: number): boolean {
		if (entry !== undefined && imageIndex === undefined && entry.kind !== 'proposal' && entry.text.length === 0 && entry.images?.length) imageIndex = 0;
		if (entry === this.entryValue && imageIndex === this.imageIndexValue) return false;
		const proposal = imageIndex === undefined && entry?.kind === 'proposal' ? entry.proposal : undefined;
		for (const listener of this.targetListeners) listener();
		if (proposal !== this.proposal) for (const listener of this.proposalListeners) listener();
		this.entryValue = entry; this.imageIndexValue = imageIndex;
		return true;
	}

	/** Navigation follows message/image order without enumerating or laying out transcript rows. */
	public move(direction: -1 | 1, entries: readonly AssistantEntry[]): boolean {
		if (entries.length === 0) return false;
		const entry = this.entryValue, imageIndex = this.imageIndexValue;
		if (entry === undefined) return this.select(entries[0]);
		const images = entry.images?.length ?? 0;
		if (direction > 0) {
			if (imageIndex === undefined && images > 0) return this.select(entry, 0);
			if (imageIndex !== undefined && imageIndex + 1 < images) return this.select(entry, imageIndex + 1);
			return entry.index + 1 < entries.length ? this.select(entries[entry.index + 1]) : false;
		}
		if (imageIndex !== undefined) {
			if (imageIndex > 0) return this.select(entry, imageIndex - 1);
			if (entry.text.length > 0 || entry.kind === 'proposal') return this.select(entry);
		}
		if (entry.index === 0) return false;
		const previous = entries[entry.index - 1], previousImages = previous.images?.length ?? 0;
		return this.select(previous, previousImages > 0 ? previousImages - 1 : undefined);
	}
}
