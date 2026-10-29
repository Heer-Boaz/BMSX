`timescale 1ns/1ps
// Real rate->scheduler->cursor->mixed PCM/BADP->shared filter/mixer. The
// sample-memory backend is a single word fixture with independent stalls;
// source binding and initial descriptors are supplied here, not by MMIO.
module apu_mixed_voice_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg frame_valid=0,output_ready=0;wire frame_ready,frame_done,decoder_begin;
 wire start_valid,start_ready,dispatch_valid,dispatch_ready,dispatch_active,frame_out_valid,frame_out_ready;
 wire [3:0] dispatch_slot;
 apu_frame_scheduler scheduler(.clk(clk),.reset_n(reset_n),.frame_valid(frame_valid),.frame_ready(frame_ready),.frame_done(frame_done),
  .active_mask(16'h003f),.decoder_epoch_begin(decoder_begin),.worker_start_valid(start_valid),.worker_start_ready(start_ready),
  .worker_slot_valid(dispatch_valid),.worker_slot_ready(dispatch_ready),.worker_slot_index(dispatch_slot),.worker_slot_active(dispatch_active),
  .worker_frame_valid(frame_out_valid),.worker_frame_ready(frame_out_ready),.output_ready(output_ready));
 reg rate_valid=0,rate_rsp_ready=0;wire rate_ready,rate_rsp_valid;wire signed [63:0] rate_whole;wire signed [31:0] rate_remainder;
 apu_voice_rate rate(.clk(clk),.reset_n(reset_n),.req_valid(rate_valid),.req_ready(rate_ready),.req_rate_q16(32'h8000),.req_source_hz(32'd44100),
  .rsp_valid(rate_rsp_valid),.rsp_ready(rate_rsp_ready),.rsp_whole_q16(rate_whole),.rsp_remainder(rate_remainder));
 reg load_valid=0;reg [3:0] load_slot=0;wire load_ready,cursor_valid,cursor_ready,cursor_active,cursor_ended;wire [3:0] cursor_slot;
 wire [31:0] cursor_frame,cursor_neighbor;wire [15:0] cursor_fraction;
`ifdef APU_FOUR_LANES
 apu_voice_cursor_lanes cursor(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
`else
 apu_voice_cursor cursor(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
`endif
  .load_cursor_q16(64'sd65536),.load_step_q16(rate_whole),.load_remainder(32'sd0),.load_step_remainder(rate_remainder),
  .load_frames(32'd8),.load_loop_start(32'd1),.load_loop_end(32'd7),.req_valid(dispatch_valid),.req_ready(dispatch_ready),
  .req_slot(dispatch_slot),.req_active(dispatch_active),.rsp_valid(cursor_valid),.rsp_ready(cursor_ready),.rsp_slot(cursor_slot),
  .rsp_active(cursor_active),.rsp_ended(cursor_ended),.rsp_frame(cursor_frame),.rsp_neighbor(cursor_neighbor),.rsp_fraction(cursor_fraction),
  .rsp_next_cursor_q16(),.rsp_next_remainder());
 reg bind_valid=0;reg [3:0] bind_voice=0;reg [18:0] bind_base=0;reg [1:0] bind_channels=1;
 wire badp_req,pcm_req;wire [16:0] badp_addr;wire [31:0] pcm_addr;reg badp_rsp=0,pcm_rsp=0;
 reg [31:0] badp_word=0,pcm_word=0;reg [31:0] memory[0:191];integer cycle=0;
 wire memory_ready=(cycle%7)!=0 && (cycle%13)!=0;
 wire [31:0] bits=cursor_slot<2 ? 32'd8 : cursor_slot<4 ? 32'd16 : 32'd4;
 wire [31:0] channels=cursor_slot[0] ? 32'd2 : 32'd1;
 wire [31:0] data_addr=32'h40000003+({28'd0,cursor_slot}<<7);
 reg signed [31:0] gains[0:5];reg [31:0] exp_frame[0:5],exp_next[0:5],exp_frac[0:5],exp_gain[0:5];integer epoch=0;
 wire signed [15:0] left,right;
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(bind_voice),.bind_source_base(bind_base),
  .bind_source_bytes(20'd128),.bind_data_offset(19'd72),.bind_frames(32'd8),.bind_channels(bind_channels),
  .bind_seek_base(bind_base+19'd64),.bind_seek_count(32'd1),.bind_loop_start(32'd1),.bind_loop_end(32'd7),
  .source_write_valid(1'b0),.source_write_word(17'd0),.source_write_words(5'd0),.epoch_begin(decoder_begin),.epoch_active(1'b1),
  .epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),
  .memory_req_valid(badp_req),.memory_req_ready(memory_ready),.memory_req_word_address(badp_addr),.memory_rsp_valid(badp_rsp),.memory_rsp_word(badp_word),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(memory_ready),.pcm_memory_req_address(pcm_addr),.pcm_memory_rsp_valid(pcm_rsp),.pcm_memory_rsp_word(pcm_word),
  .start_valid(start_valid),.start_ready(start_ready),.slot_valid(cursor_valid),.slot_ready(cursor_ready),.slot_active(cursor_active),.slot_generator_kind(32'd0),.slot_generator_duty_q12(32'd0),
  .slot_reset(epoch==0 && cursor_active),.slot_frame(cursor_frame),.slot_neighbor(cursor_neighbor),.slot_bits_per_sample(bits),.slot_channels(channels),.slot_data_address(data_addr),
  .slot_fraction(cursor_fraction),.slot_gain_q12(cursor_active ? gains[cursor_slot] : 32'sd0),.slot_level_lr_q14(32'h40004000),
  .slot_filter_clear(epoch==0 && cursor_active),.slot_filter_control(cursor_slot==1 ? 32'd0 : 32'd1),
  .slot_filter_b0_b1(32'h20002000),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),
  .frame_valid(frame_out_valid),.frame_ready_out(frame_out_ready),.frame_left(left),.frame_right(right));
 integer badp_reads=0,pcm_reads=0,stalls=0;
 always @(posedge clk)begin
  if(reset_n)cycle<=cycle+1;
  badp_rsp<=badp_req && memory_ready;pcm_rsp<=pcm_req && memory_ready;
  if(badp_req && pcm_req)$fatal(1,"both codecs requested single memory simultaneously");
  if((badp_req||pcm_req) && !memory_ready)stalls<=stalls+1;
  if(badp_req && memory_ready)begin badp_word<=memory[badp_addr];badp_reads<=badp_reads+1;end
  if(pcm_req && memory_ready)begin
   if(pcm_addr<32'h40000000 || pcm_addr>=32'h40000300 || pcm_addr[1:0]!=0)$fatal(1,"bad absolute PCM address %h",pcm_addr);
   pcm_word<=memory[(pcm_addr-32'h40000000)>>2];pcm_reads<=pcm_reads+1;
  end
  if(cursor_valid&&cursor_ready)begin
   if(cursor_slot<6)begin
    if(!cursor_active||cursor_ended||cursor_frame!==exp_frame[cursor_slot]||cursor_neighbor!==exp_next[cursor_slot]||cursor_fraction!==exp_frac[cursor_slot][15:0]||gains[cursor_slot]!==exp_gain[cursor_slot])
     $fatal(1,"cursor slot %d epoch %d",cursor_slot,epoch);
   end else if(cursor_active)$fatal(1,"unexpected active slot");
  end
 end
 integer f,rc,frames,voices,words,i,elapsed,max_elapsed=0,start_cycle,misses=0;reg [31:0] word,expected;
 initial begin
  f=$fopen("build/tests/apu-mixed-voice-vectors.txt","r");if(!f)$fatal(1,"missing vectors");
  rc=$fscanf(f,"%d %d %d",frames,voices,words);if(rc!=3||voices!=6||words!=192)$fatal(1,"header");
  for(i=0;i<words;i=i+1)begin rc=$fscanf(f,"%h",word);if(rc!=1)$fatal(1,"word");memory[i]=word;end
  gains[0]=4096;gains[1]=2048;gains[2]=-2048;gains[3]=3333;gains[4]=1024;gains[5]=-4096;
  repeat(2)@(negedge clk);reset_n=1;
  @(negedge clk);while(!rate_ready)@(negedge clk);rate_valid=1;@(negedge clk);rate_valid=0;while(!rate_rsp_valid)@(negedge clk);
  for(i=0;i<6;i=i+1)begin @(negedge clk);load_valid=1;load_slot=i;
   if(i>=4)begin bind_valid=1;bind_voice=i;bind_base=i*128;bind_channels=(i==4?1:2);end
   @(negedge clk);load_valid=0;bind_valid=0;end
  rate_rsp_ready=1;@(negedge clk);rate_rsp_ready=0;
  for(epoch=0;epoch<frames;epoch=epoch+1)begin
   for(i=0;i<6;i=i+1)begin rc=$fscanf(f,"%d %d %d %h",exp_frame[i],exp_next[i],exp_frac[i],exp_gain[i]);if(rc!=4)$fatal(1,"descriptor");end
   rc=$fscanf(f,"%h",expected);if(rc!=1)$fatal(1,"expected");
   @(negedge clk);while(!frame_ready)@(negedge clk);frame_valid=1;start_cycle=cycle;@(negedge clk);frame_valid=0;
   while(!frame_out_valid)@(negedge clk);elapsed=cycle-start_cycle;if(elapsed>max_elapsed)max_elapsed=elapsed;if(elapsed>768)misses=misses+1;
   if({right,left}!==expected)$fatal(1,"epoch %0d got %h expected %h",epoch,{right,left},expected);
   repeat(epoch%3)begin @(negedge clk);if(!frame_out_valid||frame_done||{right,left}!==expected)$fatal(1,"output stall");end
   output_ready=1;@(negedge clk);output_ready=0;
  end
  if(!pcm_reads||!badp_reads||!stalls)$fatal(1,"missing source/stall coverage");
  $display("PASS %0d mixed PCM8/PCM16 and BADP mono/stereo frames with cursor/rate/shared filter/mixer vs TS/C++; word-memory fixture, PCM reads=%0d BADP reads=%0d stalls=%0d max=%0d/768 misses=%0d",frames,pcm_reads,badp_reads,stalls,max_elapsed,misses);$finish;
 end
 initial begin #5000000;$fatal(1,"timeout");end
endmodule
