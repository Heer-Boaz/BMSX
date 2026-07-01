export function luaFloorDivide(left: number, right: number): number {
	return Math.floor(left / right);
}

export function luaModulo(left: number, right: number): number {
	return left - luaFloorDivide(left, right) * right;
}
