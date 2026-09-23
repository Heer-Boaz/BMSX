import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { WorkspaceEditProposal, WorkspaceEditProposalState } from '../../services/working_copy/workspace_edit';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { EditReviewRow } from './projection';
import type { EditorFont } from '../../../editor/ui/view/font';

let nextReviewId = 1;

/** Ephemeral review of accepted source bytes; never serialized or restored as edit rights. */
export class WorkspaceEditReviewInput extends ReadonlyEditorInput<`edit-review:${number}`, 'workspace_edit_review'> {
	public get resource(): undefined { return undefined; }
	public readonly actionBar = createWorkbenchActionBar('workspaceEditReview.title');
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	public readonly rows: EditReviewRow[] = [];
	public heading = '';
	public status = '';
	public renderedState: WorkspaceEditProposalState | undefined;
	public projectedWidth = -1;
	public projectedFont: EditorFont | null = null;
	public constructor(public readonly proposal: WorkspaceEditProposal) {
		super(`edit-review:${nextReviewId++}`, 'workspace_edit_review', 'REVIEW', true);
		this.setLabel('REVIEW', proposal.title);
		this.disposables.add(proposal);
	}
}
