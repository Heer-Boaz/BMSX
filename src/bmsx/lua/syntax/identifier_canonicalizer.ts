import type { CanonicalizationType } from '../../rompack/format';

export function createIdentifierCanonicalizer(mode: CanonicalizationType): (value: string) => string {
	if (mode === 'upper') {
		return (value: string) => value.toUpperCase();
	}
	if (mode === 'lower') {
		return (value: string) => value.toLowerCase();
	}
	return (value: string) => value;
}
