export type RevivableObjectArgs = { constructReason?: 'revive' };

export function onsave(_value: (...args: any[]) => any, _context: ClassMethodDecoratorContext): void {
}

export function onload(_value: (...args: any[]) => any, _context: ClassMethodDecoratorContext): void {
}

export function excludepropfromsavegame(_value: undefined, _context: ClassFieldDecoratorContext): void {
}

export function insavegame(...args: any[]): any {
	if (typeof args[0] === 'string' && args.length === 1) {
		return function (): void {
		};
	}
}

export function excludeclassfromsavegame(_value: any, _context: ClassDecoratorContext): void {
}
