type RockCell = { x: number; y: number };

// Rows are 32-bit wall masks;
// stair words store the column, first row, and exclusive end row in three u8s.
// All coordinates in the tape are relative to the room, in tiles.
export function packPietiousCollision(
	rows: readonly string[], rocks: readonly RockCell[], appendWords: (bytes: Buffer) => number,
): number {
	const width = rows[0].length;
	if (width > 32 || rows.length > 255 || rows.some(row => row.length !== width))
		throw new Error('Pietious collision rows must be rectangular and fit the room tape.');
	for (const rock of rocks) {
		if (rock.x < 0 || rock.x + 2 > width || rock.y < 0 || rock.y + 2 > rows.length)
			throw new Error('Pietious rock footprint must be inside the room.');
	}
	// Rock ordinals are the authored object order, preserved by the room template.
	// Keep the fixed-room variant directory small; it is not a generic world grid.
	if (rocks.length > 8) throw new Error('Pietious room collision supports at most eight authored rocks.');
	const variants = Buffer.alloc((1 << rocks.length) * 4);
	const directory = appendWords(variants);
	for (let mask = 0; mask < 1 << rocks.length; ++mask) {
		const activeRows = rows.slice();
		for (let i = 0; i < rocks.length; ++i) {
			if (!(mask & (1 << i))) continue;
			const { x, y } = rocks[i];
			for (let dy = 0; dy < 2; ++dy) {
				const row = activeRows[y + dy];
				activeRows[y + dy] = row.slice(0, x) + '##' + row.slice(x + 2);
			}
		}
		const wallWords = new Uint32Array(rows.length);
		const stairs: number[] = [];
		for (let y = 0; y < rows.length; ++y) {
			const row = activeRows[y];
			for (let x = 0; x < width; ++x) {
				if (row[x] === '#' || row[x] === '$') wallWords[y] |= 1 << x;
			}
		}
		for (let x = 0; x + 1 < width; ++x) {
			let first = -1;
			for (let y = 0; y <= rows.length; ++y) {
				const row = activeRows[y];
				if (y < rows.length && (row[x] === '-' || row[x] === '_') && (row[x + 1] === '=' || row[x + 1] === '+')) {
					if (first < 0) first = y;
				} else if (first >= 0) {
					stairs.push(x | (first << 8) | (y << 16));
					first = -1;
				}
			}
		}
		const bytes = Buffer.alloc((1 + rows.length + stairs.length) * 4);
		bytes.writeUInt32LE(stairs.length);
		for (let y = 0; y < rows.length; ++y) bytes.writeUInt32LE(wallWords[y], (1 + y) * 4);
		for (let i = 0; i < stairs.length; ++i) bytes.writeUInt32LE(stairs[i], (1 + rows.length + i) * 4);
		variants.writeUInt32LE(appendWords(bytes), mask * 4);
	}
	return directory;
}
