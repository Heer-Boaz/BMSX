// Deliberately faulty external peer for lifecycle/error tests, not a fake model.
import { createInterface } from 'node:readline';
const mode = process.argv[2];
const lines = createInterface({ input: process.stdin });
const write = message => process.stdout.write(`${JSON.stringify(message)}\n`);
let first;
if (mode === 'hang') setInterval(() => {}, 1000);
lines.on('line', line => {
	const request = JSON.parse(line);
	if (request.method === undefined) {
		write({ id: first.id, result: request.result });
		return;
	}
	switch (mode) {
		case 'multiplex':
			if (!first) { first = request; write({ id: 9, method: 'tool', params: {} }); }
			else {
				for (let n = 0; n < 10000; ++n) write({ method: 'delta', params: { text: 'x' } });
				write({ id: request.id, result: 'second' });
			}
			break;
		case 'malformed': process.stdout.write('{invalid json\n'); break;
		case 'unknown': write({ id: 'unowned', result: null }); break;
		case 'crash': process.exit(17); break;
		case 'hang': write({ method: 'waiting', params: {} }); break;
		case 'eof': break;
	}
});
