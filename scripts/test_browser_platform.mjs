import { run } from 'node:test';
import { tap } from 'node:test/reporters';

// One Node worker owns the browser processes; tests own the pages.
// With isolation disabled, Node 22's CLI does not admit concurrent tests.
const tests = run({ isolation: 'none', concurrency: 4, files: process.argv.slice(2) });
tests.on('test:fail', () => { process.exitCode = 1; });
tests.compose(tap).pipe(process.stdout);
