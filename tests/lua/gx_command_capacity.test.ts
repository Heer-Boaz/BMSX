import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { StringValue } from '../../machine/ts/machine/cpu/value';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { materializeCpuCompletionValues } from './cpu_test_harness';

// Real command writer/compiler/guest CPU, with the DMA consumer replaced at
// its source-lifetime boundary. Read source words only when wait0 releases the
// transfer, so early reuse corrupts the recorded stream rather than passing.
const checks = `local failed
local check_index=0
local assert<const> = function(condition,message)
 check_index=check_index+1
 if not condition and failed==nil then failed=message or ('GX assertion '..check_index) end
end
`;

const modules = [
	...['cartlib/gx/command_list', 'cartlib/gx/gp0'].map(path => ({
		path, source: readFileSync(`${path}.lua`, 'utf8'),
	})),
	{ path: 'cartlib/irq/source', source: 'return {gpu=1}' },
	{ path: 'cartlib/irq', source: `local handlers<const> = {}
return {
 register=function(source,handler) handlers[source]=handler end,
 trigger=function(source) handlers[source]() end,
}` },
	{ path: 'cartlib/gx/gpu', source: `local gpu<const> = {acknowledgements=0}
function gpu.ack_irq() gpu.acknowledgements=gpu.acknowledgements+1 end
return gpu` },
	{ path: 'cartlib/dma', source: `local irq<const> = require('cartlib/irq')
local irq_source<const> = require('cartlib/irq/source')
local dma<const> = {block_words=16,transfers={}}
local pending
function dma.wait0_idle()
 if pending == nil then return end
 local words<const>: *word = pending.source
 local transfer<const> = {count=pending.count,words={}}
 for index=0,pending.count-1 do transfer.words[index+1]=words[index] end
 dma.transfers[#dma.transfers+1]=transfer
 pending=nil
 for index=1,transfer.count do
  if transfer.words[index]==0x1f000000 then irq.trigger(irq_source.gpu) end
 end
end
function dma.wait1_idle() end
function dma.copy_to_gp0(source,count)
 assert(pending==nil,'command storage was resubmitted before DMA released it')
 pending={source=source,count=count}
end
return dma` },
];

for (const optLevel of [0, 3] as const) {
	for (const capacity of [16, 32] as const) {
		test(`GX bulk triangles stream ordered packets through ${capacity}-word storage (O${optLevel})`, () => {
			const { cpu } = createCartlibProgramHarness(checks + `
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local dma<const> = require('cartlib/dma')
bss storage: word[${capacity + 2}]
local guard<const>: *word = storage
guard[0],guard[${capacity + 1}]=0x13579bdf,0x2468ace0
local words<const>: *word = storage+sizeof(word)
local draw<const> = commands.new(words,${capacity})
commands.begin(draw,0x123,0x00010002)
draw:rect(1,2,3,4,0xff123456)
local prefix<const> = {words[0],words[1],words[2],words[3]}
local offset<const> = draw.drawing_offset
local colors<const>,xy0<const>,xy1<const>,xy2<const>,order<const> = {},{},{},{},{}
local count<const> = 1031
for index=1,count do
 colors[index]=0x20000000|index
 xy0[index]=0x00010000|index
 xy1[index]=0x00020000|index
 xy2[index]=0x00030000|index
 order[index]=count-index+1
end
draw:triangle_words_batch(colors,xy0,xy1,xy2,order,count)
assert(draw.word_count==0 and draw.word_capacity==${capacity})
assert(draw.draw_mode==0x123 and draw.drawing_offset==offset
 and draw.base_drawing_offset==offset and draw.target_x==2 and draw.target_y==1,
 'partial submission reset the ordered GPU state cache')
assert(guard[0]==0x13579bdf and guard[${capacity + 1}]==0x2468ace0,
 'bulk triangles exceeded the declared allocation')
local transfers<const> = dma.transfers
local first<const> = transfers[1]
assert(first.count==4,'bulk triangles did not submit the complete earlier prefix')
for index=1,4 do assert(first.words[index]==prefix[index]) end
local emitted=0
for transfer_index=2,#transfers do
 local transfer<const> = transfers[transfer_index]
 assert(transfer.count<=${capacity} and (transfer.count&3)==0)
 if transfer_index<#transfers then assert(transfer.count==${capacity}) end
 for index=1,transfer.count,4 do
  local triangle<const> = order[emitted+1]
  assert(transfer.words[index]==colors[triangle]
   and transfer.words[index+1]==xy0[triangle]
   and transfer.words[index+2]==xy1[triangle]
   and transfer.words[index+3]==xy2[triangle],
   'chunking changed sorted triangle order or native packet words')
  emitted=emitted+1
 end
end
assert(emitted==count and transfers[#transfers].count==(count%(${capacity}>>2))*4,
 'bulk submission lost or retained the partial final run')
local transfer_count<const> = #transfers
draw:mode(0x123)
assert(draw.word_count==0,'partial submission needlessly re-emitted unchanged mode')
draw:rect(5,6,7,8,0xffabcdef)
assert(draw.word_count==3 and words[0]==(gp0.draw_rectangle|gp0.argb_to_rgb(0xffabcdef)),
 'following HUD did not start at the beginning of the reused allocation')
commands.submit_fenced(draw)
local tail<const> = transfers[#transfers]
assert(#transfers==transfer_count+1 and tail.count==4 and tail.words[4]==gp0.irq_request)
assert(require('cartlib/gx/gpu').acknowledgements==1 and draw.word_count==0)
return failed
`, { optLevel, modules });
			assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
			const [failure] = materializeCpuCompletionValues(cpu);
			assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
		});
	}

	test(`GX exact-capacity fence tail and empty batches preserve the stream (O${optLevel})`, () => {
		const { cpu } = createCartlibProgramHarness(checks + `
local commands<const> = require('cartlib/gx/command_list')
local gp0<const> = require('cartlib/gx/gp0')
local dma<const> = require('cartlib/dma')
bss storage: word[18]
local guard<const>: *word = storage
guard[0],guard[17]=0x13579bdf,0x2468ace0
local words<const>: *word = storage+sizeof(word)
local draw<const> = commands.new(words,16)
commands.begin(draw,0x100,0)
local initial_mode_word<const> = words[0]
local empty<const> = {}
draw:triangle_words_batch(empty,empty,empty,empty,empty,0)
assert(draw.word_count==1 and #dma.transfers==0 and words[0]==initial_mode_word,
 'empty batch submitted or discarded an earlier prefix')
for index=1,5 do draw:rect(index,0,index+1,1,0xff000000|index) end
assert(draw.word_count==16)
commands.submit_fenced(draw)
assert(#dma.transfers==2 and dma.transfers[1].count==16
 and dma.transfers[2].count==1 and dma.transfers[2].words[1]==gp0.irq_request,
 'the final IRQ marker exceeded an exactly full allocation')
assert(guard[0]==0x13579bdf and guard[17]==0x2468ace0 and draw.word_count==0)
assert(require('cartlib/gx/gpu').acknowledgements==1)
commands.submit(draw)
assert(#dma.transfers==2 and draw.word_count==0,
 'submitting an empty queue programmed an unnecessary DMA transfer')
local colors<const> = {0x20302010,0x20605040,0x20908070,0x20c0b0a0}
local xy0<const>,xy1<const>,xy2<const>,order<const> = {1,2,3,4},{5,6,7,8},{9,10,11,12},{2,4,1,3}
draw:triangle_words_batch(colors,xy0,xy1,xy2,order,4)
assert(#dma.transfers==3 and dma.transfers[3].count==16 and draw.word_count==0,
 'exact-capacity triangle run created an empty extra submission')
commands.submit_fenced(draw)
assert(#dma.transfers==4 and dma.transfers[4].count==1
 and dma.transfers[4].words[1]==gp0.irq_request)
assert(require('cartlib/gx/gpu').acknowledgements==2
 and guard[0]==0x13579bdf and guard[17]==0x2468ace0)
return failed
`, { optLevel, modules });
		assert.equal(cpu.runUntilDepth(0, 20_000_000), RunResult.Halted);
		const [failure] = materializeCpuCompletionValues(cpu);
		assert.equal(failure, null, failure === null ? undefined : cpu.stringPool.toString((failure as StringValue).id));
	});
}
