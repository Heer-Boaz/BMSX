`timescale 1ns/1ps
// Real sample-publication/snapshot owner and the mixed PCM/BADP mixer. A
// one-clock 32-bit memory model replaces physical SRAM; pending frame edges
// and source configuration are supplied by the test rather than full APU MMIO.
module apu_mixed_snapshot_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,edge_open=0,edge_close=0;
 reg stage_valid=0,start_valid=0;wire start_ready,batch_busy,publish_valid;wire [4:0] publish_words;
 wire [16:0] publish_base;wire epoch_active,snapshot_ready,snapshot_overflow,snapshot_changed;wire [16:0] change_first,change_last;
 wire badp_req,pcm_req,read_ready,read_rsp,store_valid,store_write,read_rsp_pcm;wire [16:0] badp_addr,store_addr;wire [31:0] pcm_addr,read_word,store_wdata;
 reg store_rsp=0;reg [31:0] store_rdata=0;reg [31:0] memory[0:127];reg response_pcm=0;
 wire read_valid=badp_req||pcm_req;wire [16:0] read_addr=pcm_req ? (pcm_addr-32'h40000000)>>2 : badp_addr;
 apu_upload_commit upload(.clk(clk),.reset_n(reset_n),.power_reset_n(1'b1),.stage_valid(stage_valid),.stage_index(4'd0),
  .stage_word(32'h00000bb8),.start_valid(start_valid),.start_ready(start_ready),.start_words(5'd1),.cancel(1'b0),.live_word_address(17'd100),
  .batch_busy(batch_busy),.publish_valid(publish_valid),.publish_words(publish_words),.publish_base(publish_base),.commit_valid(),.commit_words(),.commit_base(),.commit_next_address(),
  .epoch_begin(edge_open),.epoch_end(edge_close),.epoch_active(epoch_active),.snapshot_ready(snapshot_ready),.snapshot_overflow(snapshot_overflow),.snapshots_pending(),
  .snapshot_change_valid(snapshot_changed),.snapshot_change_first(change_first),.snapshot_change_last(change_last),.queued_words(),.epoch_words(),
  .read_valid(read_valid),.read_ready(read_ready),.read_word_address(read_addr),.read_rsp_valid(read_rsp),.read_rsp_word(read_word),.memory_ready(1'b1),
  .store_req_valid(store_valid),.store_req_ready(1'b1),.store_req_write(store_write),.store_req_word_address(store_addr),.store_req_wdata(store_wdata),.store_req_be_n(),
  .store_rsp_valid(store_rsp),.store_rsp_rdata(store_rdata));
 always @(posedge clk)begin
  store_rsp<=store_valid;if(store_valid)begin if(store_write)memory[store_addr]<=store_wdata;else store_rdata<=memory[store_addr];end
  if(read_valid && read_ready)response_pcm<=pcm_req;
  if(badp_req && pcm_req)$fatal(1,"two codecs used one word port at once");
  if(pcm_req && (pcm_addr<32'h40000000 || pcm_addr>=32'h40000200))$fatal(1,"PCM address %h",pcm_addr);
 end
 reg bind_valid=0,start_valid_mix=0,slot_valid=0,slot_active=0,slot_reset=0,output_ready=0;
 reg [31:0] slot_bits=0,slot_data_address=0,slot_channels=1;wire start_ready_mix,slot_ready,frame_valid;wire signed [15:0] left,right;
 apu_badp_mix mixer(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd1),.bind_source_base(19'd0),.bind_source_bytes(20'd128),
  .bind_data_offset(19'd64),.bind_frames(32'd8),.bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),
  .source_write_valid(publish_valid),.source_write_word(publish_base),.source_write_words(publish_words),.epoch_begin(start_valid_mix && start_ready_mix),.epoch_active(epoch_active),
  .epoch_change_valid(snapshot_changed),.epoch_change_first(change_first),.epoch_change_last(change_last),
  .memory_req_valid(badp_req),.memory_req_ready(read_ready),.memory_req_word_address(badp_addr),.memory_rsp_valid(read_rsp && !response_pcm),.memory_rsp_word(read_word),
  .pcm_memory_req_valid(pcm_req),.pcm_memory_req_ready(read_ready),.pcm_memory_req_address(pcm_addr),.pcm_memory_rsp_valid(read_rsp && response_pcm),.pcm_memory_rsp_word(read_word),
  .start_valid(start_valid_mix),.start_ready(start_ready_mix),.slot_valid(slot_valid),.slot_ready(slot_ready),.slot_active(slot_active),.slot_generator_kind(32'd0),.slot_generator_duty_q12(32'd0),.slot_reset(slot_reset),
  .slot_bits_per_sample(slot_bits),.slot_channels(slot_channels),.slot_data_address(slot_data_address),.slot_frame(32'd0),.slot_neighbor(32'd0),.slot_fraction(16'd0),
  .slot_gain_q12(32'sd4096),.slot_level_lr_q14(32'h40004000),.slot_filter_clear(1'b0),.slot_filter_control(32'd0),.slot_filter_b0_b1(32'd0),.slot_filter_b2_a1(32'd0),.slot_filter_a2(32'd0),
  .frame_valid(frame_valid),.frame_ready_out(output_ready),.frame_left(left),.frame_right(right));
 task automatic capture;begin @(negedge clk);if(!snapshot_ready)$fatal(1,"unexpected snapshot full");edge_open=1;@(negedge clk);edge_open=0;end endtask
 task automatic render(input bit reset_badp,input [31:0] expected);
  integer i;
  begin @(negedge clk);while(!start_ready_mix)@(negedge clk);start_valid_mix=1;@(negedge clk);start_valid_mix=0;
   for(i=0;i<16;i=i+1)begin @(negedge clk);while(!slot_ready)@(negedge clk);
    slot_valid=1;slot_active=(i<2);slot_reset=(i==1 && reset_badp);slot_bits=(i==0?16:4);slot_data_address=32'h40000190;
    @(negedge clk);slot_valid=0;end
   while(!frame_valid)@(negedge clk);if({right,left}!==expected)$fatal(1,"snapshot got %h expected %h",{right,left},expected);
   repeat(2)begin @(negedge clk);if(!frame_valid||{right,left}!==expected)$fatal(1,"frame stall");end
   output_ready=1;edge_close=1;@(negedge clk);output_ready=0;edge_close=0;
  end
 endtask
 integer i,f,rc,count;reg [31:0] expected0,expected1;
 initial begin
  f=$fopen("build/tests/apu-mixed-snapshot-vectors.txt","r");if(!f)$fatal(1,"missing TS/C++ vectors");
  rc=$fscanf(f,"%d %h %h",count,expected0,expected1);if(rc!=3 || count!=2)$fatal(1,"invalid vector file");
  for(i=0;i<128;i=i+1)memory[i]=0;memory[16]=32'h000c0008;memory[17]=32'h00140064;memory[18]=32'h11111111;memory[100]=32'h000003e8;
  repeat(2)@(negedge clk);reset_n=1;@(negedge clk);bind_valid=1;@(negedge clk);bind_valid=0;
  capture();@(negedge clk);stage_valid=1;@(negedge clk);stage_valid=0;
  while(!start_ready)@(negedge clk);start_valid=1;@(negedge clk);start_valid=0;
  wait(publish_valid);@(negedge clk);capture();
  if(snapshot_overflow)$fatal(1,"snapshot overflow");
  render(1,expected0);render(0,expected1);
  if(epoch_active)$fatal(1,"snapshots did not retire");
  $display("PASS PCM/BADP mixed reads share actual upload/snapshot owner: 1000 then 3000 across delayed views, BADP retained, TS/C++ outputs; memory backend fixture");$finish;
 end
 initial begin #200000;$fatal(1,"timeout");end
endmodule
