import fs from 'node:fs';
import path from 'node:path';
import { collectCppPublicSymbols } from './cpp_public_symbols';
import {
	type PublicField,
	type PublicMethod,
	type PublicSignature,
	type PublicSymbol,
	type PublicSymbolParityEntry,
	type PublicSymbols,
	signatureKeys,
} from './public_model';
import { collectTypescriptPublicSymbols } from './typescript_public_symbols';

export type { PublicSymbolParityEntry } from './public_model';

export function auditPublicSymbolParity(
	repoRoot: string,
	entries: readonly PublicSymbolParityEntry[],
): string[] {
	const errors: string[] = [];
	const validEntries = entries.filter((entry) => {
		let valid = true;
		if (!fs.existsSync(path.join(repoRoot, entry.ts))) {
			errors.push(`${entry.ts}: public parity TS owner missing`);
			valid = false;
		}
		for (const file of entry.cpp_headers) {
			if (!fs.existsSync(path.join(repoRoot, file))) {
				errors.push(`${file}: public parity C++ owner missing`);
				valid = false;
			} else if (!/\.(?:h|hpp)$/.test(file)) {
				errors.push(`${file}: public parity C++ owner must be a header`);
				valid = false;
			}
		}
		return valid;
	});
	const tsSymbols = collectTypescriptPublicSymbols(
		repoRoot,
		validEntries.map((entry) => entry.ts),
	);
	const cppSymbols = collectCppPublicSymbols(
		repoRoot,
		validEntries.map((entry) => entry.cpp_headers),
	);
	for (let index = 0; index < validEntries.length; index += 1) {
		const entry = validEntries[index];
		compareOwners(
			entry,
			tsSymbols.get(entry.ts)!,
			cppSymbols[index],
			errors,
		);
	}
	return errors;
}

function compareOwners(
	entry: PublicSymbolParityEntry,
	tsSymbols: PublicSymbols,
	cppSymbols: PublicSymbols,
	errors: string[],
): void {
	for (const name of tsSymbols.keys()) {
		if (!cppSymbols.has(name)) {
			errors.push(`${entry.ts}: public symbol ${name} missing from ${entry.cpp_headers.join(', ')}`);
		}
	}
	for (const name of cppSymbols.keys()) {
		if (!tsSymbols.has(name)) {
			errors.push(`${entry.cpp_headers.join(', ')}: public symbol ${name} missing from ${entry.ts}`);
		}
	}
	for (const [name, tsSymbol] of tsSymbols) {
		const cppSymbol = cppSymbols.get(name);
		if (cppSymbol) {
			compareSymbol(`${entry.ts}:${name}`, tsSymbol, cppSymbol, errors);
		}
	}
}

function compareSymbol(
	label: string,
	tsSymbol: PublicSymbol,
	cppSymbol: PublicSymbol,
	errors: string[],
): void {
	if (tsSymbol.kind !== cppSymbol.kind) {
		errors.push(`${label}: TS kind ${tsSymbol.kind} differs from C++ kind ${cppSymbol.kind}`);
		return;
	}
	switch (tsSymbol.kind) {
		case 'type': {
			if (cppSymbol.kind !== 'type') return;
			if (tsSymbol.shape !== cppSymbol.shape) {
				errors.push(`${label}: TS type ${describe(tsSymbol.shape)} differs from C++ ${describe(cppSymbol.shape)}`);
				return;
			}
			if (tsSymbol.shape === 'record') {
				compareShape(label, 'fields', fieldShape(tsSymbol.fields), fieldShape(cppSymbol.fields), errors);
				compareMethods(label, tsSymbol.methods, cppSymbol.methods, errors);
			}
			return;
		}
		case 'enum': {
			if (cppSymbol.kind !== 'enum') return;
			const semanticLabels = tsSymbol.semanticLabels || cppSymbol.semanticLabels;
			const tsMembers = tsSymbol.members
				.map((member) => semanticLabels ? member.name.toLowerCase() : `${member.name}=${member.value}`)
				.join(',');
			const cppMembers = cppSymbol.members
				.map((member) => semanticLabels ? member.name.toLowerCase() : `${member.name}=${member.value}`)
				.join(',');
			if (tsMembers !== cppMembers) {
				errors.push(`${label}: TS enum (${tsMembers}) differs from C++ (${cppMembers})`);
			}
			return;
		}
		case 'function':
			if (cppSymbol.kind === 'function') {
				compareShape(
					label,
					'signatures',
					normalizedSignatureSet(tsSymbol.signatures),
					normalizedSignatureSet(cppSymbol.signatures),
					errors,
				);
			}
			return;
		case 'value':
			if (cppSymbol.kind !== 'value') return;
			if (tsSymbol.readonly !== cppSymbol.readonly) {
				errors.push(`${label}: TS readonly=${tsSymbol.readonly} differs from C++ readonly=${cppSymbol.readonly}`);
			}
			if (tsSymbol.type !== cppSymbol.type) {
				errors.push(`${label}: TS value type ${describe(tsSymbol.type)} differs from C++ ${describe(cppSymbol.type)}`);
			}
			if (
				tsSymbol.value !== undefined
				&& cppSymbol.value !== undefined
				&& tsSymbol.value !== cppSymbol.value
			) {
				errors.push(`${label}: TS value ${tsSymbol.value} differs from C++ ${cppSymbol.value}`);
			}
			return;
	}
}

function compareShape(
	label: string,
	kind: string,
	tsShape: string,
	cppShape: string,
	errors: string[],
): void {
	if (tsShape !== cppShape) {
		errors.push(`${label}: TS ${kind} (${describe(tsShape)}) differ from C++ (${describe(cppShape)})`);
	}
}

function fieldShape(fields: readonly PublicField[]): string {
	return fields
		.map((field) => `${field.name}${field.optional ? '?' : ''}:${field.type}`)
		.sort()
		.join(',');
}

function compareMethods(
	label: string,
	tsMethods: readonly PublicMethod[],
	cppMethods: readonly PublicMethod[],
	errors: string[],
): void {
	const tsByName = new Map(tsMethods.map((method) => [method.name, method.signatures]));
	const cppByName = new Map(cppMethods.map((method) => [method.name, method.signatures]));
	for (const [name, signatures] of tsByName) {
		const cppSignatures = cppByName.get(name);
		if (!cppSignatures) {
			errors.push(`${label}: TS public method ${name} missing from C++`);
		} else {
			compareShape(
				`${label}.${name}`,
				'signatures',
				normalizedSignatureSet(signatures),
				normalizedSignatureSet(cppSignatures),
				errors,
			);
		}
	}
	for (const name of cppByName.keys()) {
		if (!tsByName.has(name)) {
			errors.push(`${label}: C++ public method ${name} missing from TS`);
		}
	}
}

function normalizedSignatureSet(signatures: readonly PublicSignature[]): string {
	const keys = new Set<string>();
	for (const signature of signatures) {
		for (const key of signatureKeys(signature)) {
			keys.add(key);
		}
	}
	return [...keys].sort().join(',');
}

function describe(shape: string): string {
	return shape.length <= 320 ? shape : `${shape.slice(0, 317)}...`;
}
