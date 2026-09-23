/** Incremental UTF-8/JSON line boundary for host streams. Join a split line once, not once per chunk. */
export async function* readJsonLines<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
	const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
	const fragments: string[] = [];
	try {
		for (;;) {
			const { done, value } = await reader.read();
			const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
			let start = 0, end: number;
			while ((end = text.indexOf('\n', start)) !== -1) {
				const part = text.slice(start, end);
				let line = part;
				if (fragments.length !== 0) { fragments.push(part); line = fragments.join(''); fragments.length = 0; }
				yield JSON.parse(line) as T;
				start = end + 1;
			}
			if (start < text.length) fragments.push(text.slice(start));
			if (done) {
				if (fragments.length !== 0) throw new Error('Host JSON stream ended inside a message');
				return;
			}
		}
	} finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
}
