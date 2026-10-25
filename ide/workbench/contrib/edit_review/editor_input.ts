import { ReadonlyEditorInput } from '../../common/editor_input';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { WorkspaceEditProposal, WorkspaceEditProposalState } from '../../services/working_copy/workspace_edit';
import { createWorkbenchActionBar, type WorkbenchActionBarState } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { createEditReviewLines, type EditReviewLine, type EditReviewRow } from './projection';
import { EditReviewReadingState } from './reading_state';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { SourceReviewEvidence } from '../../common/source_review';

let nextReviewId = 1;
const EMPTY_EVIDENCE: SourceReviewEvidence = { summary: '', items: [] };

/** Ephemeral review of accepted source bytes; never serialized or restored as edit rights. */
export class WorkspaceEditReviewInput extends ReadonlyEditorInput<`edit-review:${number}`, 'workspace_edit_review'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly actionBar: WorkbenchActionBarState;
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	public readonly rows: EditReviewRow[] = [];
	public readonly lines: readonly EditReviewLine[];
	public readonly rowStorage = new ScratchBuffer<EditReviewRow>(() => ({ text: '', kind: 'header', line: undefined!, start: 0, end: 0, decoration: 0, endDecoration: 0 }));
	public readonly reading = new EditReviewReadingState();
	public heading = '';
	public status = '';
	public renderedState: WorkspaceEditProposalState | undefined;
	public projectedWidth = -1;
	public projectedFont: EditorFont | null = null;
	public constructor(public readonly proposal: WorkspaceEditProposal, public readonly evidence: SourceReviewEvidence = EMPTY_EVIDENCE) {
		super(`edit-review:${nextReviewId++}`, 'workspace_edit_review', 'REVIEW', true);
		this.actionBar = createWorkbenchActionBar(evidence.items.length === 0 ? 'workspaceEditReview.title' : 'workspaceEditReview.evidence.title', true);
		this.lines = createEditReviewLines(proposal.files, evidence);
		this.setLabel('REVIEW', proposal.title);
		this.disposables.add(proposal);
	}
}
