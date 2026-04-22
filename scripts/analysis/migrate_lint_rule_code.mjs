import { spawnSync } from 'node:child_process';

const result = spawnSync('bash', ['scripts/analysis/split_lint_monoliths.sh'], {
	stdio: 'inherit',
});

if (result.error) {
	throw result.error;
}

process.exit(result.status ?? 0);
