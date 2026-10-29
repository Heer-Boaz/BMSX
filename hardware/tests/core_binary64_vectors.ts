// Operation semantics match the Number operations used by the TS CPU; no
// oracle assumptions are made for the payload/sign of a resulting NaN.
const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);
function number(bits: bigint): number { view.setBigUint64(0, bits, false); return view.getFloat64(0, false); }
function bits(value: number): bigint { view.setFloat64(0, value, false); return view.getBigUint64(0, false); }
function hex(value: bigint): string { return value.toString(16).padStart(16, '0'); }
const edges = [0n,0x8000000000000000n,1n,0x000fffffffffffffn,0x0010000000000000n,
 0x3ca0000000000000n,0x3ff0000000000000n,0xbff0000000000000n,0x4008000000000000n,
 0x7fefffffffffffffn,0xffefffffffffffffn,0x7ff0000000000000n,0xfff0000000000000n,
 0x7ff8000000000000n,0x7ff0000000000001n,0xfff8000000000001n];
let random=0x13579bdf2468ace0n;
function next(): bigint { random ^= random << 13n;random ^= random >> 7n;random ^= random << 17n;random &= 0xffffffffffffffffn;return random; }
const rows: string[]=[];
function emit(op: number,a: bigint,b: bigint): void {
 const x=number(a),y=number(b);
 const z=op===0?x+y:op===1?x-y:op===2?x*y:x/y;
 rows.push(`${op} ${hex(a)} ${hex(b)} ${hex(bits(z))}`);
}
for(let op=0;op<4;op++) {
 for(const a of edges)for(const b of edges)emit(op,a,b);
 if(op<2)for(let n=48;n<=64;n++)for(const sign of [0n,0x8000000000000000n]) {
  const b=BigInt(1023-n)<<52n;
  emit(op,0x3ff0000000000000n,sign|b);
  emit(op,0xbff0000000000000n,sign|b);
 }
 // Adjacent significands with opposite signs leave a long cancellation
 // prefix. Exercise both exponent extremes and the observed long ADD case;
 // throughput here includes the existing serial left-normalization path.
 if(op<2) {
  emit(op,0xe590fd1c6e5f448en,0x6590fd1c6e5f448fn);
  for(const exponent of [1n,2n,16n,511n,1022n,1023n,1534n,2045n,2046n])
   for(const fraction of [0n,1n,0x123456789abcn,0xffffffffffffen])
    for(const sign of [0n,0x8000000000000000n]) {
     const a=sign|(exponent<<52n)|fraction;
     const b=(sign^0x8000000000000000n)|(exponent<<52n)|(fraction+1n);
     emit(op,a,b);
    }
 }
 for(let i=0;i<1024;i++)emit(op,next(),next());
}
process.stdout.write(`${rows.length}\n${rows.join('\n')}\n`);
