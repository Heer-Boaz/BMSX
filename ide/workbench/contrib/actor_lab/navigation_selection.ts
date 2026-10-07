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
		readonly scrollX: number;
		readonly scrollY: number;
		readonly zoom: number;
	} | undefined;
	public readonly follow: ActorTarget | undefined;
	public readonly detailsOpen: boolean;
	public readonly detailsSelection: ActorDetailsSelection | undefined;
	public readonly detailsScroll: number;
	private readonly outlineScroll: number;
	private readonly splitRatio: number;
	private readonly detailsRatio: number;
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
			scrollX: graph.viewport.scrollX, scrollY: graph.viewport.scrollY, zoom: graph.viewport.zoom,
		};
		this.follow = input.follow.target;
		this.detailsOpen = input.detailsOpen;
		this.detailsSelection = input.detailsSelection;
		this.detailsScroll = input.detailsScroll;
		this.outlineScroll = input.outline.scroll;
		this.splitRatio = input.split.ratio;
		this.detailsRatio = input.detailsSplit.ratio;
	}

	public matches(other: ActorLabNavigationSelection): boolean {
		return this.generation === other.generation && this.presentation === other.presentation
			&& (this.target === undefined ? other.target === undefined : other.target !== undefined && actorTargetsEqual(this.target, other.target))
			&& (this.graph === undefined ? other.graph === undefined : other.graph !== undefined
				&& this.graph.kind === other.graph.kind && actorTargetsEqual(this.graph.target, other.graph.target))
			&& this.detailsOpen === other.detailsOpen && actorDetailsSelectionsEqual(this.detailsSelection, other.detailsSelection);
	}

	public restoreDetails(input: ActorLabInput): void {
		input.detailsOpen = this.detailsOpen;
		input.detailsSelection = this.detailsSelection;
		input.detailsScroll = this.detailsScroll;
		input.split.resize(this.splitRatio);
		input.detailsSplit.resize(this.detailsRatio);
	}

	/** Restore scroll after the pane lays out the reacquired rows and diagram. */
	public restoreViewport(input: ActorLabInput): void {
		input.outline.scroll = this.outlineScroll;
		if (this.graph !== undefined && input.presentation === 'graph') {
			const viewport = input.stateGraph!.viewport;
			viewport.setZoom(this.graph.zoom);
			viewport.scrollX = this.graph.scrollX;
			viewport.scrollY = this.graph.scrollY;
		}
	}
}
