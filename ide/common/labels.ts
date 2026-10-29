import { ELLIPSIS } from './text';

/** Fewest distinguishing whole path segments; equal-length choices prefer the suffix. */
export function shortenLabelPaths(paths: readonly string[]): string[] {
	const components = paths.map(path => path.split('/'));
	const labels: string[] = [];
	for (let index = 0; index < paths.length; index++) {
		const path = components[index];
		let label = paths[index];
		search: for (let length = 1; length <= path.length; length++) {
			for (let start = path.length - length; start >= 0; start--) {
				const suffix = start + length === path.length;
				let unique = true;
				for (let other = 0; other < paths.length && unique; other++) {
					if (other === index) continue;
					const candidate = components[other], last = candidate.length - length;
					for (let offset = suffix ? last : 0; offset >= 0 && offset <= last; offset++) {
						let equal = true;
						for (let part = 0; part < length; part++) if (path[start + part] !== candidate[offset + part]) { equal = false; break; }
						if (equal) { unique = false; break; }
					}
				}
				if (unique) {
					label = `${start === 0 ? '' : `${ELLIPSIS}/`}${path.slice(start, start + length).join('/')}${suffix ? '' : `/${ELLIPSIS}`}`;
					break search;
				}
			}
		}
		labels.push(label);
	}
	return labels;
}
