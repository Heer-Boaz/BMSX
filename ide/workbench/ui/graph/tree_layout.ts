/*
 * Buchheim / Reingold-Tilford tidy tree, adapted from d3-hierarchy:
 * https://github.com/d3/d3-hierarchy/blob/c6fa6b98d1028e80b27982c003a2a5ac5e8e3c87/src/tree.js
 * Measured card widths replace unit separation; levels use measured heights.
 *
 * Copyright 2010-2021 Mike Bostock
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */
import type { RectBounds } from '../../../../machine/ts/common/rect';

export type WorkbenchTreeNode = {
	readonly bounds: RectBounds;
	readonly children: readonly WorkbenchTreeNode[];
};

class LayoutNode {
	public parent!: LayoutNode;
	public readonly children: LayoutNode[] = [];
	public defaultAncestor: LayoutNode | undefined;
	public ancestor: LayoutNode = this;
	public preliminary = 0;
	public modifier = 0;
	public change = 0;
	public shift = 0;
	public thread: LayoutNode | null = null;
	public readonly width: number;
	public readonly height: number;

	public constructor(public readonly node: WorkbenchTreeNode, public readonly index: number, public readonly depth: number) {
		this.width = node.bounds.right - node.bounds.left;
		this.height = node.bounds.bottom - node.bounds.top;
	}
}

/** Cold layout only. Authored sibling order is unchanged; no viewport squeezing. */
export function layoutWorkbenchTree(root: WorkbenchTreeNode, siblingGap: number, levelGap: number): void {
	const tree = new LayoutNode(root, 0, 0);
	const sentinel = new LayoutNode(root, 0, -1);
	tree.parent = sentinel;
	sentinel.children.push(tree);
	const pending = [tree];
	const nodes: LayoutNode[] = [];
	const levelHeights: number[] = [];
	while (pending.length > 0) {
		const node = pending.pop()!;
		nodes.push(node);
		if (node.depth === levelHeights.length) levelHeights.push(node.height);
		else levelHeights[node.depth] = Math.max(levelHeights[node.depth], node.height);
		for (let index = 0; index < node.node.children.length; index += 1) {
			const child = new LayoutNode(node.node.children[index], index, node.depth + 1);
			child.parent = node;
			node.children.push(child);
			pending.push(child);
		}
	}
	// Reverse right-first DFS is left-to-right postorder, as in d3 eachAfter.
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index];
		const siblings = node.parent.children;
		const previous = node.index === 0 ? null : siblings[node.index - 1];
		if (node.children.length > 0) {
			executeShifts(node);
			const midpoint = (node.children[0].preliminary + node.children[node.children.length - 1].preliminary) / 2;
			if (previous !== null) {
				node.preliminary = previous.preliminary + (previous.width + node.width) / 2 + siblingGap;
				node.modifier = node.preliminary - midpoint;
			} else node.preliminary = midpoint;
		} else if (previous !== null) node.preliminary = previous.preliminary + (previous.width + node.width) / 2 + siblingGap;
		node.parent.defaultAncestor = apportion(node, previous,
			node.parent.defaultAncestor === undefined ? siblings[0] : node.parent.defaultAncestor, siblingGap);
	}
	let top = 0;
	for (let depth = 0; depth < levelHeights.length; depth += 1) {
		const height = levelHeights[depth];
		levelHeights[depth] = top;
		top += height + levelGap;
	}
	sentinel.modifier = -tree.preliminary;
	for (const node of nodes) {
		const bounds = node.node.bounds;
		bounds.left = Math.round(node.preliminary + node.parent.modifier - node.width / 2);
		bounds.top = levelHeights[node.depth];
		bounds.right = bounds.left + node.width;
		bounds.bottom = bounds.top + node.height;
		node.modifier += node.parent.modifier;
	}
}

function nextLeft(node: LayoutNode): LayoutNode | null {
	return node.children.length > 0 ? node.children[0] : node.thread;
}

function nextRight(node: LayoutNode): LayoutNode | null {
	return node.children.length > 0 ? node.children[node.children.length - 1] : node.thread;
}

function executeShifts(node: LayoutNode): void {
	let shift = 0;
	let change = 0;
	for (let index = node.children.length - 1; index >= 0; index -= 1) {
		const child = node.children[index];
		child.preliminary += shift;
		child.modifier += shift;
		change += child.change;
		shift += child.shift + change;
	}
}

function moveSubtree(left: LayoutNode, right: LayoutNode, shift: number): void {
	const change = shift / (right.index - left.index);
	right.change -= change;
	right.shift += shift;
	left.change += change;
	right.preliminary += shift;
	right.modifier += shift;
}

function apportion(node: LayoutNode, previous: LayoutNode | null, ancestor: LayoutNode, gap: number): LayoutNode {
	if (previous === null) return ancestor;
	let innerRight: LayoutNode | null = node;
	let outerRight = node;
	let innerLeft: LayoutNode | null = previous;
	let outerLeft = node.parent.children[0];
	let innerRightSum = innerRight.modifier;
	let outerRightSum = outerRight.modifier;
	let innerLeftSum = innerLeft.modifier;
	let outerLeftSum = outerLeft.modifier;
	for (;;) {
		innerLeft = nextRight(innerLeft);
		innerRight = nextLeft(innerRight);
		if (innerLeft === null || innerRight === null) break;
		outerLeft = nextLeft(outerLeft)!;
		outerRight = nextRight(outerRight)!;
		outerRight.ancestor = node;
		const shift = innerLeft.preliminary + innerLeftSum - innerRight.preliminary - innerRightSum
			+ (innerLeft.width + innerRight.width) / 2 + gap;
		if (shift > 0) {
			moveSubtree(innerLeft.ancestor.parent === node.parent ? innerLeft.ancestor : ancestor, node, shift);
			innerRightSum += shift;
			outerRightSum += shift;
		}
		innerLeftSum += innerLeft.modifier;
		innerRightSum += innerRight.modifier;
		outerLeftSum += outerLeft.modifier;
		outerRightSum += outerRight.modifier;
	}
	if (innerLeft !== null && nextRight(outerRight) === null) {
		outerRight.thread = innerLeft;
		outerRight.modifier += innerLeftSum - outerRightSum;
	}
	if (innerRight !== null && nextLeft(outerLeft) === null) {
		outerLeft.thread = innerRight;
		outerLeft.modifier += innerRightSum - outerLeftSum;
		ancestor = node;
	}
	return ancestor;
}
