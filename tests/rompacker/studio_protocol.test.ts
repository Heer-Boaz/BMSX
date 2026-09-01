import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as protocol from '../../ide/workbench/contrib/studio/protocol';

test('Studio host and guest publish one mirrored raw-word protocol', () => {
	const lua = readFileSync('cartlib/studio/protocol.lua', 'utf8');
	const guestWords = new Map<string, number>();
	for (const match of lua.matchAll(/^\s*([a-z0-9_]+)\s*=\s*(0x[0-9a-f]+|[0-9]+),$/gmi)) {
		guestWords.set(`STUDIO_${match[1]!.toUpperCase()}`, Number(match[2]));
	}
	const hostWords = Object.entries(protocol);
	assert.equal(guestWords.size, hostWords.length);
	for (let index = 0; index < hostWords.length; index += 1) {
		const [name, value] = hostWords[index]!;
		assert.equal(guestWords.get(name), value, name);
	}
});
