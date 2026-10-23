import { ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { ActorNode } from './runtime';

const COMPONENT_LABELS: Readonly<Record<string, string>> = {
	FSM: 'State machines', BT: 'Behavior tree', TIMELINES: 'Timelines', ACTIONEFFECTS: 'Action effects', COMPONENT: 'Component',
};

/** Outline rows and Details captions share one name; typed identity and full paths stay intact. */
export function actorNodeLabel(node: ActorNode, siblings: readonly ActorNode[], actor: ActorNode): string {
	let label = node.name;
	const namespace = actor.name + '.';
	if (label.startsWith(namespace)) {
		const compact = label.slice(namespace.length);
		let ambiguous = false;
		for (const sibling of siblings) if (sibling !== node && sibling.prefix === node.prefix && sibling.name === compact) {
			ambiguous = true; break;
		}
		if (!ambiguous) label = compact;
	}
	if (node.prefix === '') return label;
	if (node.keyIdentity.tag === ValueTag.String) return `${COMPONENT_LABELS[node.prefix]}: ${label}`;
	for (const sibling of siblings) {
		if (sibling !== node && sibling.prefix === node.prefix) return `${COMPONENT_LABELS[node.prefix]} #${node.name}`;
	}
	return COMPONENT_LABELS[node.prefix];
}
