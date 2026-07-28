export function luaFloorDivide(left: number, right: number): number {
	const quotient = left / right;
	const integer = Math.trunc(quotient);
	return integer > quotient ? integer - 1 : integer;
}

export function luaModulo(left: number, right: number): number {
	return left - luaFloorDivide(left, right) * right;
}
