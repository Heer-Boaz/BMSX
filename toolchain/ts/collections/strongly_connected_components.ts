/** Traversal metadata belongs to each owner's temporary dependency nodes. */
export interface StronglyConnectedNode<T> {
	readonly dependencies: readonly T[];
	index: number;
	lowlink: number;
	component: number;
	active: boolean;
}

/**
 * Iterative Tarjan, dependency-first. Nodes start with index/component -1 and
 * active false; the traversal consumes this construction-only metadata.
 */
export function stronglyConnectedComponents<T extends StronglyConnectedNode<T>>(roots: Iterable<T>): T[][] {
	const components: T[][] = [];
	const active: T[] = [];
	const traversal: { node: T; next: number }[] = [];
	let nextIndex = 0;
	for (const root of roots) {
		if (root.index !== -1) continue;
		root.index = root.lowlink = nextIndex++;
		root.active = true;
		active.push(root);
		traversal.push({ node: root, next: 0 });
		while (traversal.length > 0) {
			const frame = traversal[traversal.length - 1];
			const node = frame.node;
			if (frame.next < node.dependencies.length) {
				const target = node.dependencies[frame.next++];
				if (target.index === -1) {
					target.index = target.lowlink = nextIndex++;
					target.active = true;
					active.push(target);
					traversal.push({ node: target, next: 0 });
				} else if (target.active) {
					node.lowlink = Math.min(node.lowlink, target.index);
				}
				continue;
			}
			traversal.pop();
			if (traversal.length > 0) {
				const parent = traversal[traversal.length - 1].node;
				parent.lowlink = Math.min(parent.lowlink, node.lowlink);
			}
			if (node.lowlink !== node.index) continue;
			const component: T[] = [];
			let member: T;
			do {
				member = active.pop()!;
				member.active = false;
				member.component = components.length;
				component.push(member);
			} while (member !== node);
			components.push(component);
		}
	}
	return components;
}
