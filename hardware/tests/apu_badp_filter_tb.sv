`timescale 1ns/1ps
// Actual BADP decoder -> interpolator -> per-slot filter -> mixer. A local
// word-memory model replaces the SRAM pin path; schedule and clear flags are
// supplied by the test, not by the incomplete APU controller.
module apu_badp_filter_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg bind_valid=0;reg [3:0] bind_voice=0;reg [18:0] bind_source_base=0,bind_data_offset=72,bind_seek_base=0;
 reg [19:0] bind_source_bytes=92;reg [31:0] bind_frames=8,bind_seek_count=1,bind_loop_start=1,bind_loop_end=7;
 reg [1:0] bind_channels=2;reg source_write_valid=0;reg [16:0] source_write_word=0;reg [4:0] source_write_words=0;
 reg epoch_begin=0,epoch_active=0;wire epoch_change_valid=0;wire [16:0] epoch_change_first=0,epoch_change_last=0;wire memory_req_valid;wire [16:0] memory_req_word_address;
 wire pcm_memory_req_valid;wire [31:0] pcm_memory_req_address;
 wire pcm_memory_req_ready=0,pcm_memory_rsp_valid=0;wire [31:0] pcm_memory_rsp_word=0;
 reg memory_rsp_valid=0;reg [31:0] memory_rsp_word=0;reg [31:0] mem[0:255];
 reg start_valid=0,slot_valid=0,slot_active=0,slot_reset=0,frame_ready_out=0;
 reg [31:0] slot_frame=0,slot_neighbor=0;reg [15:0] slot_fraction=0;reg signed [31:0] slot_gain_q12=0;
 wire [31:0] slot_bits_per_sample=4,slot_channels=2,slot_data_address=0;
 wire [31:0] slot_generator_kind=0,slot_generator_duty_q12=0;
 reg [31:0] slot_level_lr_q14=32'h40004000;reg slot_filter_clear=0;
 reg [31:0] slot_filter_control=0,slot_filter_b0_b1=0,slot_filter_b2_a1=0,slot_filter_a2=0;
 wire start_ready,slot_ready,frame_valid;wire signed [15:0] frame_left,frame_right;
 apu_badp_mix dut(.memory_req_ready(1'b1),.*);
 always @(posedge clk) begin memory_rsp_valid<=memory_req_valid;if(memory_req_valid)memory_rsp_word<=mem[memory_req_word_address];end
 integer cycle=0;always @(posedge clk)if(reset_n)cycle<=cycle+1;
 integer filter_clips=0;
 always @(posedge clk) if(reset_n && (dut.state==10 || dut.state==11 || dut.state==12) &&
  (slot_ready || frame_valid))$fatal(1,"accepted slot or emitted frame while filter operation pending");
 always @(posedge clk) if(reset_n && dut.filter.state==3 &&
  (dut.filter.y>32'sd32767 || dut.filter.y< -32'sd32768))filter_clips<=filter_clips+1;
 integer f,rc,frames,voices,words,channels,epoch,v,slot,reset,clear,start,elapsed,max_cycles=0,over=0;
 reg [31:0] expected,held;
 initial begin #10000000;$fatal(1,"watchdog");end
 initial begin
  f=$fopen("build/tests/apu-badp-filter-vectors.txt","r");if(!f)$fatal(1,"missing vectors");
  rc=$fscanf(f,"%d %d %d %d",frames,voices,words,channels);if(rc!=4 || words!=256)$fatal(1,"header");
  for(v=0;v<words;v=v+1)begin rc=$fscanf(f,"%h",mem[v]);if(rc!=1)$fatal(1,"image");end
  repeat(3)@(negedge clk);reset_n=1;@(negedge clk);
  for(v=0;v<voices;v=v+1)begin bind_valid=1;bind_voice=v;bind_source_base=v*128;bind_seek_base=v*128+64;@(negedge clk);end
  bind_valid=0;
  for(epoch=0;epoch<frames;epoch=epoch+1)begin
   start=cycle;epoch_begin=1;@(negedge clk);epoch_begin=0;while(!start_ready)@(negedge clk);
   start_valid=1;@(negedge clk);start_valid=0;
   for(slot=0;slot<16;slot=slot+1)begin
    while(!slot_ready)@(negedge clk);
    if(slot<voices)begin
     rc=$fscanf(f,"%d %d %d %h %d %h %h %h %h %d",slot_frame,slot_neighbor,slot_fraction,slot_gain_q12,reset,
      slot_filter_control,slot_filter_b0_b1,slot_filter_b2_a1,slot_filter_a2,clear);
     if(rc!=10)$fatal(1,"frame %0d slot %0d",epoch,slot);slot_active=1;slot_reset=reset;slot_filter_clear=clear;
    end else begin slot_active=0;slot_reset=0;slot_filter_clear=0;slot_filter_control=0;end
    slot_valid=1;@(negedge clk);slot_valid=0;
   end
   rc=$fscanf(f,"%h",expected);if(rc!=1)$fatal(1,"expected output");while(!frame_valid)@(negedge clk);
   elapsed=cycle-start;if(elapsed>max_cycles)max_cycles=elapsed;if(elapsed>768)over=over+1;
   held={frame_right,frame_left};if(held!==expected)$fatal(1,"epoch %0d expected %h got %h",epoch,expected,held);
   repeat(2)begin @(negedge clk);if(!frame_valid || {frame_right,frame_left}!==held)$fatal(1,"output stall");end
   frame_ready_out=1;@(negedge clk);frame_ready_out=0;
  end
  if(filter_clips==0)$fatal(1,"filter saturation was not exercised");
  $display("PASS %0d TS/C++ BADP-filter-mix frames, 8 stereo voices, live coefficient/enable changes, PLAY reset and seek with retained history, filter_clips=%0d",frames,filter_clips);
  $display("MEASURE local-memory test schedule max_clocks=%0d frames_over_768=%0d; not physical SRAM/DAC deadline",max_cycles,over);
  $finish;
 end
endmodule
