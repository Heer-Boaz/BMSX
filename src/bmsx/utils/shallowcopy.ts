/**
 * Creates a copy of a Vector object.
 * @param toCopy - The Vector object to be copied.
 * @returns A new Vector object with the same x, y and z values as the original.
 */
export function shallowcopy<T>(toCopy: T): T {
	if (toCopy === null || toCopy === undefined) {
		return toCopy;
	}
	if (Array.isArray(toCopy)) {
		return [...toCopy] as T;
	}
	if (typeof toCopy === 'object') {
		return { ...toCopy } as T;
	}
	return toCopy;
}
