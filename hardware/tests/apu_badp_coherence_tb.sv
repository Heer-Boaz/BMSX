`timescale 1ns/1ps
// A coherent local word memory; decoder and nibble datapath are production
// RTL. Expected samples are emitted by actual TS and cross-checked against C++.
module apu_badp_coherence_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,bind_valid=0,req_valid=0,req_reset=0;
 reg [31:0] req_frame=0;
 reg source_write_valid=0;reg [16:0] source_write_word=0;reg [4:0] source_write_words=0;
 reg epoch_begin=0,epoch_active=0;
 wire req_ready,rsp_valid;wire [31:0] rsp_samples;
 wire memory_req_valid;wire [16:0] memory_req_word_address;
 reg memory_rsp_valid=0;reg [31:0] memory_rsp_word=0;
 reg [31:0] mem[0:127],snapshot[0:127];
 apu_badp_decoder dut(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd0),
 .bind_source_base(19'd0),.bind_source_bytes(20'd4),.bind_data_offset(19'd64),
 .bind_frames(32'd8),.bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),
 .bind_loop_start(32'd0),.bind_loop_end(32'd8),.req_valid(req_valid),.req_ready(req_ready),
 .req_reset(req_reset),.req_voice(4'd0),.req_frame(req_frame),.rsp_valid(rsp_valid),.rsp_samples(rsp_samples),
 .source_write_valid(source_write_valid),.source_write_word(source_write_word),.source_write_words(source_write_words),
 .epoch_begin(epoch_begin),.epoch_active(epoch_active),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),.memory_req_valid(memory_req_valid),.memory_req_ready(1'b1),
 .memory_req_word_address(memory_req_word_address),.memory_rsp_valid(memory_rsp_valid),.memory_rsp_word(memory_rsp_word));
 always @(posedge clk) begin
  memory_rsp_valid<=memory_req_valid;
  if(epoch_begin) for(integer w=0;w<128;w=w+1) snapshot[w]<=mem[w];
  if(memory_req_valid) memory_rsp_word<=epoch_active ? snapshot[memory_req_word_address] : mem[memory_req_word_address];
 end
 task automatic request(input bit reset_op,input [31:0] frame,input [31:0] expected,input bit check);
  begin @(negedge clk);while(!req_ready)@(negedge clk);req_reset=reset_op;req_frame=frame;req_valid=1;
   @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
   if(check && rsp_samples!==expected)$fatal(1,"frame %0d expected %h got %h",frame,expected,rsp_samples);
  end
 endtask
 integer f,rc,i;reg [31:0] a,b,c,d,e,g;
 initial begin
  f=$fopen("build/tests/apu-badp-coherence-vectors.txt","r"); if(!f)$fatal(1,"missing oracle");
  rc=$fscanf(f,"%h %h %h %h %h %h",a,b,c,d,e,g);if(rc!=6)$fatal(1,"bad oracle");
  for(i=0;i<128;i=i+1)mem[i]=0;
  mem[16]=32'h000c0008;mem[17]=32'h00140064;mem[18]=32'h11111111;
  repeat(2)@(negedge clk);reset_n=1;@(negedge clk);bind_valid=1;
  @(negedge clk);bind_valid=0;
  request(1,0,0,0);request(0,0,a,1);request(0,1,b,1);request(0,2,c,1);
  if(!dut.checkpoint_valid[0])$fatal(1,"no canonical checkpoint");
  @(negedge clk);mem[17]=32'h001403e8;source_write_valid=1;source_write_word=17;source_write_words=1;
  @(negedge clk);source_write_valid=0;request(0,0,d,1);
  // Existing current/previous decoded values survive source edits. The next
  // forward step also follows the retained predictor until a seek reloads it.
  @(negedge clk);mem[17]=32'h00140064;source_write_valid=1;source_write_word=17;source_write_words=1;
  @(negedge clk);source_write_valid=0;request(0,0,e,1);request(0,1,g,1);
  // A fresh bind resets provenance. Disjoint publication must not invalidate
  // a useful checkpoint simply because it is in the same sample SRAM.
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  request(1,0,0,0);request(0,0,a,1);request(0,1,b,1);request(0,2,c,1);
  @(negedge clk);source_write_valid=1;source_write_word=100;source_write_words=1;#1;
  if(dut.touched!==0)$fatal(1,"disjoint publication invalidated provenance");
  @(negedge clk);source_write_valid=0;
  // New snapshot, before this voice has observed any word: modify a future
  // header word, then read its old snapshot. Its checkpoint must be marked
  // dirty for the next epoch even though publication preceded the first read.
  @(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  @(negedge clk);epoch_begin=1;@(negedge clk);epoch_begin=0;epoch_active=1;
  @(negedge clk);mem[17]=32'h001403e8;source_write_valid=1;source_write_word=17;source_write_words=1;
  @(negedge clk);source_write_valid=0;
  request(1,0,0,0);request(0,0,a,1);request(0,1,b,1);request(0,2,c,1);
  if(!dut.dirty[0])$fatal(1,"earlier publication missed by subsequent snapshot read");
  @(negedge clk);epoch_begin=1;@(negedge clk);epoch_begin=0;
  request(0,0,d,1);
  // Repeat with publication exactly on the first request of that header word.
  @(negedge clk);epoch_active=0;mem[17]=32'h00140064;
  while(!req_ready)@(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  @(negedge clk);epoch_begin=1;@(negedge clk);epoch_begin=0;epoch_active=1;
  fork
   begin request(1,0,0,0);request(0,0,a,1);request(0,1,b,1);request(0,2,c,1);end
   begin
    wait(memory_req_valid && memory_req_word_address==17);
    @(negedge clk);mem[17]=32'h001403e8;source_write_valid=1;source_write_word=17;source_write_words=1;
    if(!memory_req_valid || memory_req_word_address!=17)$fatal(1,"not a same-edge first read");
    @(negedge clk);source_write_valid=0;
   end
  join
  if(!dut.dirty[0])$fatal(1,"same-edge publication and first read missed");
  @(negedge clk);epoch_begin=1;@(negedge clk);epoch_begin=0;request(0,0,d,1);
  // The final physical word alone does not wrap; a 20-word burst from there
  // does wrap and reaches the observed header at word 17.
  @(negedge clk);source_write_valid=1;source_write_word=17'h1ffff;source_write_words=1;#1;
  if(dut.touched[0])$fatal(1,"terminal single word incorrectly wraps");
  source_write_words=20;#1;
  if(!dut.touched[0])$fatal(1,"wrapped publication missed observed header");
  source_write_valid=0;
  // A publication on the opening edge is part of the new snapshot, and
  // invalidates old checkpoints without erasing the retained current sample.
  @(negedge clk);mem[17]=32'h00140064;source_write_valid=1;source_write_word=17;source_write_words=1;epoch_begin=1;
  @(negedge clk);source_write_valid=0;epoch_begin=0;
  request(0,0,d,1);request(0,2,0,0);request(0,0,a,1);
  $display("PASS actual TS/C++ BADP parity, out-of-extent mutation, retained PCM, disjoint writes and snapshot provenance");$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
