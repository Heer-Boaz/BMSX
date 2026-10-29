import type { WorkbenchGraphViewState } from '../../ui/graph/viewport';
import { EditorPaneSelection } from '../../services/editor/editor_selection';
import type { ActorLabInput } from './editor_input';
import { actorTargetsEqual, type ActorTarget } from './target';
import { actorDetailsSelectionsEqual, type ActorDetailsSelection } from './details';

/** History retains machine identities and view coordinates, never a borrowed actor or a rewind position. */
export class ActorLabNavigationSelection extends EditorPaneSelection {
	public readonly target: ActorTarget | undefined;
	public readonly presentation: ActorLabInput['presentation'];
	public readonly graph: {
		readonly target: ActorTarget;
		readonly kind: 'node' | 'edge';
		readonly camera: WorkbenchGraphViewState;
	} | undefined;
	public readonly follow: ActorTarget | undefined;
	public readonly detailsOpen: boolean;
	public readonly detailsSelection: ActorDetailsSelection | undefined;
	public readonly detailsScroll: number;
	public readonly detailsSubject: ActorTarget | undefined;
	public readonly detailsLocked: boolean;
	public readonly detailsSubjectPath: string;
	public readonly detailsSubjectName: string;
	public readonly detailsRetired: boolean;
	private readonly outlineScroll: number;
	private readonly splitRatio: number;
	private readonly rowSplitRatio: number;
	public constructor(input: ActorLabInput, worldHashId: number | undefined, public readonly generation: number) {
		super();
		this.presentation = input.presentation;
		const graph = input.presentation === 'graph' ? input.stateGraph : undefined;
		const path = graph === undefined ? input.selectionPath : graph.selectionBookmark?.path;
		this.target = worldHashId === undefined ? undefined : {
			domain: input.domain, worldHashId, actorHashId: input.actorHashId, path: path ?? [],
		};
		this.graph = graph?.machineTarget === undefined ? undefined : {
			target: graph.machineTarget, kind: graph.selectionType,
			camera: graph.viewport.captureViewState(),
		};
		this.follow = input.follow.target;
		this.detailsOpen = input.detailsWindow.open;
		this.detailsSelection = input.detailsSelection;
		this.detailsScroll = input.detailsScroll;
		const details = input.details!;
		this.detailsSubject = details.subject;
		this.detailsLocked = details.locked;
		this.detailsSubjectPath = details.subjectPath;
		this.detailsSubjectName = details.subjectName;
		this.detailsRetired = details.retired;
		this.outlineScroll = input.outline.scroll;
		this.splitRatio = input.split.ratio;
		this.rowSplitRatio = input.rowSplit.ratio;
	}

	public matches(other: ActorLabNavigationSelection): boolean {
		return this.generation === other.generation && this.presentation === other.presentation
			&& (this.target === undefined ? other.target === undefined : other.target !== undefined && actorTargetsEqual(this.target, other.target))
			&& (this.graph === undefined ? other.graph === undefined : other.graph !== undefined
				&& this.graph.kind === other.graph.kind && actorTargetsEqual(this.graph.target, other.graph.target))
			&& this.detailsOpen === other.detailsOpen && this.detailsLocked === other.detailsLocked && this.detailsRetired === other.detailsRetired
			&& (this.detailsSubject === undefined ? other.detailsSubject === undefined
				: other.detailsSubject !== undefined && actorTargetsEqual(this.detailsSubject, other.detailsSubject))
			&& actorDetailsSelectionsEqual(this.detailsSelection, other.detailsSelection);
	}

	public restoreDetails(input: ActorLabInput, admitted: boolean): void {
		input.detailsWindow.open = this.detailsOpen;
		input.detailsSelection = this.detailsSelection;
		input.detailsScroll = this.detailsScroll;
		input.details!.restoreSubject(admitted ? this.detailsSubject : undefined, admitted && this.detailsLocked,
			admitted ? this.detailsSubjectPath : '', admitted ? this.detailsSubjectName : '', admitted && this.detailsRetired);
		input.split.ratio = this.splitRatio;
		input.rowSplit.ratio = this.rowSplitRatio;
	}

	/** Restore scroll after the pane lays out the reacquired rows and diagram. */
	public restoreViewport(input: ActorLabInput): void {
		input.outline.scroll = this.outlineScroll;
		if (this.graph !== undefined && input.presentation === 'graph') {
			const viewport = input.stateGraph!.viewport;
			viewport.restoreViewState(this.graph.camera);
		}
	}
}
