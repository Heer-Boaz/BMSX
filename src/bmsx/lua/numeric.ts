export function luaModulo(left: number, right: number): number {
	return left - Math.floor(left / right) * right;
}
