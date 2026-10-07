import { ValueTag, valueTypeNameForLuaTag } from '../../../../machine/ts/machine/cpu/value';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { ActorNode } from './runtime';

export type ActorMemberChoice = QuickPickItem & { readonly node: ActorNode };

/** One suspended membership catalog, including collapsed descendants and distinct aliases. */
export function createActorMemberChoices(roots: readonly ActorNode[], selected: ActorNode | undefined): TextQuickPickProvider<ActorMemberChoice> {
	const items: ActorMemberChoice[] = [];
	let selectionIndex = 0;
	const visit = (nodes: readonly ActorNode[], parent: string): void => {
		const labels = new Map<string, number>();
		const references = new Map<number, number>();
		for (const node of nodes) {
			labels.set(node.label, (labels.get(node.label) ?? 0) + 1);
			references.set(node.hashId, (references.get(node.hashId) ?? 0) + 1);
		}
		for (const node of nodes) {
			if (node === selected) selectionIndex = items.length;
			const duplicate = labels.get(node.label)! > 1;
			const keyType = node.keyIdentity.tag === ValueTag.String ? '' : ` / ${valueTypeNameForLuaTag(node.keyIdentity.tag)} key`;
			// Aliases can share both display name and value identity. Only those need the typed key as well.
			const alias = duplicate && references.get(node.hashId)! > 1 ? ` / key ${node.keyIdentity.tag}:${node.keyIdentity.scalar}` : '';
			const member = duplicate ? `${node.label} [#${node.hashId}${alias}]` : node.label;
			const path = parent === '' ? member : `${parent} / ${member}`;
			items.push({ label: node.label, description: `${node.kind.toUpperCase()} #${node.hashId}${keyType}${alias}`, detail: path, node });
			if (node.children.length !== 0) visit(node.children, path);
		}
	};
	visit(roots, '');
	return new TextQuickPickProvider(items, selectionIndex);
}
