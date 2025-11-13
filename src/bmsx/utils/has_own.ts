export function has_own(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}
