import type { RuntimeResource } from '../../../common/models';
import { shortenLabelPaths } from '../../../common/labels';
import type { AbstractEditorInput } from '../../common/editor_input';

export function computeResourceTabTitle(resource: RuntimeResource): string {
	const parts = resource.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return resource.source.type.toUpperCase();
}

/** Source identity for disambiguating tabs; never part of their input identity. */
export function sourceTabDescription(resource: Pick<RuntimeResource, 'contextLabel' | 'path'>, line?: number): string {
	return `${resource.contextLabel}${line === undefined ? '' : `:${line}`} / ${resource.path}`;
}

/** Basename tabs already show the filename; their directory label retains its source context. */
export function sourceTabDirectory(resource: Pick<RuntimeResource, 'contextLabel' | 'path'>): string {
	const separator = resource.path.lastIndexOf('/');
	return separator === -1 ? resource.contextLabel : `${resource.contextLabel}/${resource.path.slice(0, separator)}`;
}

type EditorLabelInput = Pick<AbstractEditorInput<string, string>, 'title' | 'description' | 'shortDescription' | 'descriptionPath'>;

/** One enumeration's labels; native/definition descriptions remain opaque unless their owner publishes a path. */
export function computeEditorLabels(inputs: readonly EditorLabelInput[]): string[] {
	const labels = inputs.map(input => input.title), groups = new Map<string, number[]>();
	for (let index = 0; index < inputs.length; index++) {
		const title = inputs[index].title, group = groups.get(title);
		if (group === undefined) groups.set(title, [index]);
		else group.push(index);
	}
	for (const group of groups.values()) {
		if (group.length === 1) continue;
		const compact = new Set<string>(), paths = new Map<string, number>();
		let hasPaths = true;
		for (const index of group) {
			const input = inputs[index]; compact.add(input.shortDescription);
			if (input.descriptionPath === undefined) hasPaths = false;
			else if (!paths.has(input.descriptionPath)) paths.set(input.descriptionPath, paths.size);
		}
		const useCompact = compact.size === group.length && !compact.has('');
		// Identical display provenance does not invent an identity for equivalent views or context aliases.
		if (!useCompact && hasPaths && paths.size === 1 && compact.size === 1) continue;
		const shortened = !useCompact && hasPaths ? shortenLabelPaths([...paths.keys()]) : undefined;
		for (const index of group) {
			const input = inputs[index];
			let description: string;
			if (useCompact) description = input.shortDescription;
			else if (shortened !== undefined) {
				const path = shortened[paths.get(input.descriptionPath!)!];
				description = compact.size > 1 ? `${input.shortDescription}: ${path}` : path;
			} else description = input.description;
			labels[index] = description.length === 0 ? input.title : `${input.title} - ${description}`;
		}
	}
	return labels;
}
