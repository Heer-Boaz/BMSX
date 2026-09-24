import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { ScrollableWorkbenchTree } from '../../ui/scrollable_tree';
import { ActorRuntimeTree } from './runtime';
import type { ActorRow } from './projection';
import type { ResourceDomain } from '../../../common/resource';
import { ActorTimelineTransport } from './timeline';
import { ActorTimelineLayout } from './timeline_layout';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';

/** View state only. Borrowed rows are released before guest execution. */
export class ActorLabInput extends ReadonlyEditorInput<'actor-lab', 'actor_lab'> {
	public get resource(): undefined { return undefined; }
	public domain: ResourceDomain = 0;
	public actorHashId = 0;
	public running = false;
	public selectionHashId = 0;
	public dirty = true;
	public status = 'CHOOSE A RUNNING ACTOR';
	public readonly runtime = new ActorRuntimeTree();
	public readonly outline = new ScrollableWorkbenchTree<ActorRow>();
	public readonly timeline = new ActorTimelineTransport();
	public readonly timelineLayout = new ActorTimelineLayout();
	public readonly previewBounds = create_rect_bounds();
	public readonly actionBar = createWorkbenchActionBar('actorLab.title');
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	public constructor() {
		super('actor-lab', 'actor_lab', 'ACTOR LAB', true);
		this.onWillDispose(() => this.runtime.dispose());
	}
	public invalidate(heapReplaced: boolean): void {
		const selected = this.outline.rows[this.outline.selectionIndex];
		if (selected !== undefined) this.selectionHashId = selected.element.node.hashId;
		this.runtime.release();
		if (heapReplaced) {
			this.runtime.roots.length = 0;
			this.timeline.clear();
			this.actorHashId = 0; this.selectionHashId = 0; this.running = false;
			this.outline.roots.length = 0; this.outline.rows.length = 0; this.outline.selectionIndex = -1;
		}
		this.dirty = true;
	}
}
