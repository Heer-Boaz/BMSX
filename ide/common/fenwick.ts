/** Mutable prefix sums for indexed view geometry. Callers supply sequence indexes. */
export class FenwickPrefix {
	private tree: number[] = [0];
	private treeSize = 0;

	public reset(size: number): void {
		this.treeSize = size;
		this.tree.length = this.treeSize + 1;
		for (let i = 0; i < this.tree.length; i += 1) {
			this.tree[i] = 0;
		}
	}

	public resizeOrClear(size: number): void {
		if (this.treeSize !== size) {
			this.reset(size);
			return;
		}
		this.clear();
	}

	public clear(): void {
		for (let i = 0; i < this.tree.length; i += 1) {
			this.tree[i] = 0;
		}
	}

	public get length(): number {
		return this.treeSize;
	}

	public add(index: number, delta: number): void {
		let i = index + 1;
		while (i <= this.treeSize) {
			this.tree[i] += delta;
			i += i & -i;
		}
	}

	public set(index: number, value: number): void {
		const current = this.prefixSum(index + 1) - this.prefixSum(index);
		this.add(index, value - current);
	}

	public prefixSum(endExclusive: number): number {
		let i = endExclusive;
		let sum = 0;
		while (i > 0) {
			sum += this.tree[i];
			i -= i & -i;
		}
		return sum;
	}

	/** Append a bucket without rebuilding earlier prefix sums. */
	public push(value: number): void {
		const next = this.treeSize + 1;
		this.tree.push(value + this.prefixSum(this.treeSize) - this.prefixSum(next - (next & -next)));
		this.treeSize = next;
	}

	/** Bucket containing offset; length denotes the end of the sequence. */
	public indexAt(offset: number): number {
		let index = 0, sum = 0, bit = 1;
		while (bit * 2 <= this.treeSize) bit *= 2;
		for (; bit > 0; bit >>>= 1) {
			const next = index + bit;
			if (next <= this.treeSize && sum + this.tree[next] <= offset) {
				index = next; sum += this.tree[next];
			}
		}
		return index;
	}

	public getTotal(): number {
		return this.prefixSum(this.treeSize);
	}
}
