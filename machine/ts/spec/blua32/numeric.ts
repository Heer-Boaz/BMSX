export function luaFloorDivide(left: number, right: number): number {
	const quotient = left / right;
	const integer = Math.trunc(quotient);
	return integer > quotient ? integer - 1 : integer;
}

export function luaModulo(left: number, right: number): number {
	let remainder = left % right;
	if (remainder > 0 ? right < 0 : remainder < 0 && right > 0) {
		remainder += right;
	}
	return remainder;
}
