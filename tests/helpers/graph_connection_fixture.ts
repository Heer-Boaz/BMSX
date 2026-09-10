import type { BFont } from '../../machine/ts/render/shared/bitmap_font';
import { createWorkbenchGraphEdge, createWorkbenchGraphLabel, createWorkbenchGraphModel, createWorkbenchGraphNode, type WorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import { WorkbenchGraphConnectionPreview, type WorkbenchGraphConnectionEnds } from '../../ide/workbench/ui/graph/connection';
import type { WorkbenchGraphConnectionDragStart, WorkbenchGraphDragSession, WorkbenchGraphDragSource, WorkbenchGraphDragStart } from '../../ide/workbench/ui/graph/drag';
import { WorkbenchGraphViewport } from '../../ide/workbench/ui/graph/viewport';

/** Independent control geometry/admission; deliberately no FSM, Lua or current cart. */
export function graphConnectionFixture(font: BFont) {
	const origin = createWorkbenchGraphNode(font, 'ORIGIN', 24, 48);
	const oldTarget = createWorkbenchGraphNode(font, 'OLD TARGET', 242, 48);
	const target = createWorkbenchGraphNode(font, 'NEW TARGET', 242, 142);
	const blocked = createWorkbenchGraphNode(font, 'NOT A PORT', 140, 96);
	const label = createWorkbenchGraphLabel(font, 'PROVEN LINK');
	label.bounds.left += 122; label.bounds.right += 122;
	label.bounds.top += 50; label.bounds.bottom += 50;
	const y = origin.bounds.top + origin.headerHeight / 2;
	const edge = createWorkbenchGraphEdge([origin.bounds.right, y, oldTarget.bounds.left, y], [label], true);
	const parallel = createWorkbenchGraphEdge([origin.bounds.right, y, 92, y, 92, y + 22, 220, y + 22, 220, y, oldTarget.bounds.left, y], [], true);
	const model = createWorkbenchGraphModel(font, [origin, oldTarget, blocked, target], [parallel, edge]);
	const view = new WorkbenchGraphViewport(model);
	view.layout(8, 24, 376, 240);
	const interaction = new GraphConnectionTestSource(view, [origin, oldTarget, target]);
	return { view, model, origin, oldTarget, target, blocked, edge, parallel, interaction };
}

export class GraphConnectionTestSource implements WorkbenchGraphDragSource {
	public ends: WorkbenchGraphConnectionEnds | undefined = 'both';
	public current = true;
	public readonly starts: WorkbenchGraphDragStart[] = [];
	public readonly drops: { start: WorkbenchGraphConnectionDragStart; target: WorkbenchGraphNode }[] = [];
	public overs = 0;
	public feedback: WorkbenchGraphConnectionPreview | undefined;
	public onDrop: (() => void) | undefined;

	public constructor(private readonly view: WorkbenchGraphViewport, private readonly targets: readonly WorkbenchGraphNode[]) {}
	public connectionEnds(): WorkbenchGraphConnectionEnds | undefined { return this.current ? this.ends : undefined; }
	public begin(start: WorkbenchGraphDragStart): WorkbenchGraphDragSession | undefined {
		this.starts.push(start);
		if (start.kind !== 'connection' || !this.current) return undefined;
		const feedback = new WorkbenchGraphConnectionPreview(start.edge, start.end);
		this.feedback = feedback;
		return {
			feedback,
			isCurrent: () => this.current,
			dragOver: (x, y) => {
				this.overs += 1;
				const hit = this.view.hitTest(x, y);
				feedback.target = hit?.kind === 'node' && this.targets.includes(hit) ? hit : undefined;
			},
			drop: () => {
				this.drops.push({ start, target: feedback.target! });
				this.onDrop?.();
			},
		};
	}
}
