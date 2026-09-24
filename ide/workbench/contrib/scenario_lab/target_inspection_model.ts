import type { TestStopInspection } from '../../../testing/stop_inspection';
import type { TestTargetInspection } from '../../../testing/retained_inspection';
import { createWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';

type Load = { kind: 'stack' | 'values'; reference: string; start: number } | { kind: 'frame'; reference: string };
export type TestInspectionElement = WorkbenchPropertyElement & { load?: Load; frame?: string };
type Node = WorkbenchTreeNode<TestInspectionElement>;
const PAGE_SIZE = 64;

/** Lazy projection of the same target attachment used by conversation tools. No guest reads during paint. */
export class TestTargetInspectionModel {
	public readonly tree = createWorkbenchPropertyTree<TestInspectionElement>();
	public constructor(public readonly inspection: TestTargetInspection | TestStopInspection) {
		const state = inspection.state;
		if (state.role === 'retained-test') for (const failure of state.failures) this.append(null, `${failure.phase}: ${failure.message}`, failure.status,
			failure.status === 'available' ? `${failure.origin}; failure cycles ${failure.cycles}. Retained at case end; cleanup may have changed shared values.` : 'No retained guest activation for this failure.',
			failure.reference === undefined ? undefined : { kind: 'stack', reference: failure.reference, start: 0 });
		else this.append(null, `Stopped thread ${state.stack.thread} / ${state.reason}`, state.stack.status,
			'Current test stop. Continuing, stepping or cleanup expires every frame and value.',
			state.stack.reference === undefined ? undefined : { kind: 'stack', reference: state.stack.reference, start: 0 });
		for (const scope of state.globals) this.append(null, `Globals / physical ${scope.domain} / source ${scope.sourceDomain}`,
			scope.status, 'Installed binding names. Values belong to this inspection of the test machine, not the authoring game.',
			scope.reference === undefined ? undefined : { kind: 'values', reference: scope.reference, start: 0 });
		rebuildWorkbenchTreeRows(this.tree, this.tree.roots[0]);
	}

	private append(parent: Node | null, label: string, value: string, description: string, load?: Load, frame?: string): Node {
		const node = appendWorkbenchTreeNode(this.tree, parent, { kind: load === undefined ? 'property' : 'group',
			label, value, description, warning: false, displayLabel: '', displayValue: '', displayValueLeft: 0, load, frame }, true);
		node.expandable = load !== undefined;
		return node;
	}

	public resolve(node: Node): void {
		const load = node.element.load;
		if (node.collapsed || load === undefined) return;
		switch (load.kind) {
			case 'stack': {
				const page = this.inspection.readStack(load.reference, load.start, PAGE_SIZE);
				for (const frame of page.frames) this.append(node, frame.functionName,
					frame.kind === 'source' ? `${frame.workspacePath}:${frame.line}:${frame.column}` : `PC ${frame.pc.toString(16)}`,
					`Physical domain ${frame.domain}, frame ${frame.physicalFrameIndex}, inline depth ${frame.inlineDepth}. Enter: compiled source.`,
					{ kind: 'frame', reference: frame.reference }, frame.reference);
				this.more(node, load, page.total);
				break;
			}
			case 'frame': {
				for (const scope of this.inspection.frameScopes(load.reference).scopes) this.append(node, scope.kind, scope.status,
					'Actual frame slots and closure captures. Unavailable locations are not guessed.',
					scope.reference === undefined ? undefined : { kind: 'values', reference: scope.reference, start: 0 });
				break;
			}
			case 'values': {
				const page = this.inspection.read(load.reference, load.start, PAGE_SIZE);
				for (const entry of page.entries) this.append(node, `${entry.key.display} [${entry.key.kind}]`, entry.value.display,
					`${entry.value.kind}${entry.definition === undefined || entry.definition === null ? '' : ` / ${entry.definition.path}:${entry.definition.start.line}`}. ${entry.value.display}`,
					entry.value.reference === undefined ? undefined : { kind: 'values', reference: entry.value.reference, start: 0 });
				this.more(node, load, page.total);
				break;
			}
		}
		node.element.load = undefined;
		node.expandable = node.children.length !== 0;
		this.tree.textDirty = true;
		rebuildWorkbenchTreeRows(this.tree, node);
	}

	private more(node: Node, load: Extract<Load, { start: number }>, total: number): void {
		const start = load.start + PAGE_SIZE;
		if (start < total) this.append(node, `More (${start} / ${total})`, '', 'Expand to read the next page.', { ...load, start });
	}
}
