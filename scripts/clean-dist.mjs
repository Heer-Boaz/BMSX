#!/usr/bin/env node

import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('dist', { recursive: true });

for (const entry of readdirSync('dist', { withFileTypes: true })) {
	if (entry.name === '.gitignore') {
		continue;
	}

	rmSync(join('dist', entry.name), { recursive: true, force: true });
}
