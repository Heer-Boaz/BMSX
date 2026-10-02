import type { ResourceDomain } from '../../../common/resource';
import type { SuspendedGuestSession, SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import type { ActorNode } from './runtime';

export type ActorNodeIdentity = { readonly hashId: number; readonly kind: ActorNode['kind']; readonly key: SuspendedValueIdentity };
export type ActorTarget = { readonly domain: ResourceDomain; readonly worldHashId: number; readonly actorHashId: number; readonly path: readonly ActorNodeIdentity[] };

/** A view correspondence uses the full typed membership, never a table id or display label alone. */
export function actorTargetsEqual(left: ActorTarget, right: ActorTarget): boolean {
	if (left.domain !== right.domain || left.worldHashId !== right.worldHashId || left.actorHashId !== right.actorHashId || left.path.length !== right.path.length) return false;
	for (let index = 0; index < left.path.length; index++) {
		const a = left.path[index], b = right.path[index];
		if (a.hashId !== b.hashId || a.kind !== b.kind || a.key.tag !== b.key.tag || a.key.scalar !== b.key.scalar) return false;
	}
	return true;
}

/** Capture membership and typed keys, not a UI node or a heap borrow. */
export function captureActorTarget(domain: ResourceDomain, worldHashId: number, roots: readonly ActorNode[], selected: ActorNode,
	guest: SuspendedGuestSession): ActorTarget {
	const path: ActorNode[] = [];
	const visit = (nodes: readonly ActorNode[]): boolean => {
		for (const node of nodes) {
			path.push(node);
			if (node === selected || visit(node.children)) return true;
			path.pop();
		}
		return false;
	};
	if (!visit(roots)) throw new Error('Actor node is no longer in the selected actor tree.');
	return { domain, worldHashId, actorHashId: roots[0].hashId,
		path: path.map(node => ({ hashId: node.hashId, kind: node.kind, key: guest.identity(node.key) })) };
}

/** Reordering is allowed; replacing membership, role or a typed key is not. */
export function resolveActorTarget(roots: readonly ActorNode[], target: ActorTarget, guest: SuspendedGuestSession): ActorNode | undefined {
	let nodes = roots, found: ActorNode | undefined;
	for (const identity of target.path) {
		found = undefined;
		for (const node of nodes) {
			if (node.hashId !== identity.hashId || node.kind !== identity.kind || !guest.matchesIdentity(node.key, identity.key)) continue;
			found = node; break;
		}
		if (found === undefined) return;
		nodes = found.children;
	}
	return found;
}
