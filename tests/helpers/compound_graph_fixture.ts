import type { BFont } from '../../machine/ts/render/shared/bitmap_font';
import { createWorkbenchGraphNode, type WorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import type { WorkbenchCompoundLink } from '../../ide/workbench/ui/graph/compound_layout';

export type CompoundFixtureNode = WorkbenchGraphNode & {
	readonly children: readonly CompoundFixtureNode[];
	readonly name: string;
	/** Main-thread identity, deliberately not structured-cloneable. */
	readonly action: () => string;
};
export type CompoundFixtureLink = WorkbenchCompoundLink<CompoundFixtureNode> & { readonly proof: string };

/** Independent geometry corpus. Names do not imply any cartlib execution semantics. */
export function compoundGraphFixture(font: BFont) {
	const nodes = new Map<string, CompoundFixtureNode>();
	function node(name: string, children: CompoundFixtureNode[] = [], text = name): CompoundFixtureNode {
		const value: CompoundFixtureNode = { ...createWorkbenchGraphNode(font, text, 0, 0), children, name, action: () => name };
		nodes.set(name, value);
		return value;
	}
	const idle = node('IDLE');
	const run = node('RUN', [], 'RUN\nLOCAL UPDATE');
	const room = node('ROOM', [idle, run]);
	const watch = node('WATCH');
	const report = node('REPORT');
	const lanes = node('LANES', [watch, report], 'LANES\nCONCURRENT');
	const done = node('DONE');
	const root = node('MACHINE', [room, lanes, done]);
	const links: CompoundFixtureLink[] = [
		{ proof: 'start', source: idle, target: run, label: 'GO' },
		{ proof: 'retry', source: idle, target: run, label: 'GO' },
		{ proof: 'back', source: run, target: idle, label: 'BACK' },
		{ proof: 'self', source: run, target: run, label: 'AGAIN' },
		{ proof: 'entry', source: room, target: idle, label: 'INITIAL' },
		{ proof: 'cross', source: run, target: watch, label: 'NOTIFY' },
		{ proof: 'join', source: report, target: room, label: 'JOIN' },
		{ proof: 'finish', source: root, target: done, label: 'FINISH' },
		{ proof: 'root-entry', source: root, target: room, label: '' },
		{ proof: 'root-self', source: root, target: root, label: 'RESET' },
	];
	return { roots: [root], nodes, links };
}
