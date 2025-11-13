
// Utility: filter an iterable with a predicate, returns an iterable (lazy generator)
export function filter_iterable<T>(iterable: Iterable<T>, predicate: (item: T) => boolean): Iterable<T> {
	function* gen() {
		for (const item of iterable) {
			if (predicate(item)) yield item;
		}
	}
	return { [Symbol.iterator]: gen };
}
