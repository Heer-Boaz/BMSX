`timescale 1ns/1ps
// Compare a four-lane cursor against the same actual serial cursor for the
// same 64 admitted slot operations, including repeated slots, inactive slots,
// unequal work and output stalls. Per-slot state is real in both datapaths.
module apu_voice_cursor_lanes_order_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0;
 reg load_valid=0;reg [3:0] load_slot=0;wire s_load_ready,p_load_ready;
 reg signed [63:0] load_cursor_q16=0,load_step_q16=0;
 reg signed [31:0] load_remainder=0,load_step_remainder=0;
 reg [31:0] load_frames=16,load_loop_start=0,load_loop_end=8;
 reg s_req_valid=0,s_req_active=0,s_rsp_ready=0;reg [3:0] s_req_slot=0;
 wire s_req_ready,s_rsp_valid,s_rsp_active,s_rsp_ended;wire [3:0] s_rsp_slot;
 wire [31:0] s_rsp_frame,s_rsp_neighbor;wire [15:0] s_rsp_fraction;
 wire signed [63:0] s_rsp_next_cursor_q16;wire signed [31:0] s_rsp_next_remainder;
 apu_voice_cursor serial(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(s_load_ready),.load_slot(load_slot),
  .load_cursor_q16(load_cursor_q16),.load_step_q16(load_step_q16),.load_remainder(load_remainder),.load_step_remainder(load_step_remainder),
  .load_frames(load_frames),.load_loop_start(load_loop_start),.load_loop_end(load_loop_end),
  .req_valid(s_req_valid),.req_ready(s_req_ready),.req_slot(s_req_slot),.req_active(s_req_active),.rsp_valid(s_rsp_valid),.rsp_ready(s_rsp_ready),
  .rsp_slot(s_rsp_slot),.rsp_active(s_rsp_active),.rsp_ended(s_rsp_ended),.rsp_frame(s_rsp_frame),.rsp_neighbor(s_rsp_neighbor),
  .rsp_fraction(s_rsp_fraction),.rsp_next_cursor_q16(s_rsp_next_cursor_q16),.rsp_next_remainder(s_rsp_next_remainder));
 reg p_req_valid=0,p_req_active=0,p_rsp_ready=0;reg [3:0] p_req_slot=0;
 wire p_req_ready,p_rsp_valid,p_rsp_active,p_rsp_ended;wire [3:0] p_rsp_slot;
 wire [31:0] p_rsp_frame,p_rsp_neighbor;wire [15:0] p_rsp_fraction;
 wire signed [63:0] p_rsp_next_cursor_q16;wire signed [31:0] p_rsp_next_remainder;
 apu_voice_cursor_lanes parallel(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(p_load_ready),.load_slot(load_slot),
  .load_cursor_q16(load_cursor_q16),.load_step_q16(load_step_q16),.load_remainder(load_remainder),.load_step_remainder(load_step_remainder),
  .load_frames(load_frames),.load_loop_start(load_loop_start),.load_loop_end(load_loop_end),
  .req_valid(p_req_valid),.req_ready(p_req_ready),.req_slot(p_req_slot),.req_active(p_req_active),.rsp_valid(p_rsp_valid),.rsp_ready(p_rsp_ready),
  .rsp_slot(p_rsp_slot),.rsp_active(p_rsp_active),.rsp_ended(p_rsp_ended),.rsp_frame(p_rsp_frame),.rsp_neighbor(p_rsp_neighbor),
  .rsp_fraction(p_rsp_fraction),.rsp_next_cursor_q16(p_rsp_next_cursor_q16),.rsp_next_remainder(p_rsp_next_remainder));
 function automatic [3:0] selected_slot(input integer n);selected_slot=(n*5+n/7)&15;endfunction
 reg [181:0] expected[0:63];integer i,sent,received,cycle,queued,max_queued,stalls;
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  for(i=0;i<16;i=i+1)begin
   @(negedge clk);load_slot=i;load_cursor_q16=$signed(i)*65536;
   load_step_q16=(i%3==0) ? 64'sh0000be37c63854e4 : (i%3==1 ? -64'sd98304 : 64'sd32768);
   load_step_remainder=(i%3==0) ? 32'sh4371 : 0;
   while(!s_load_ready || !p_load_ready)@(negedge clk);
   load_valid=1;@(negedge clk);load_valid=0;
  end
  // The serial reference is run once; it uses the unchanged physical cursor.
  for(i=0;i<64;i=i+1)begin
   @(negedge clk);while(!s_req_ready)@(negedge clk);
   s_req_slot=selected_slot(i);s_req_active=(i%7)!=0;s_req_valid=1;
   @(negedge clk);s_req_valid=0;while(!s_rsp_valid)@(negedge clk);
   expected[i]={s_rsp_slot,s_rsp_active,s_rsp_ended,s_rsp_frame,s_rsp_neighbor,s_rsp_fraction,s_rsp_next_cursor_q16,s_rsp_next_remainder};
   s_rsp_ready=1;@(negedge clk);s_rsp_ready=0;
  end
  sent=0;received=0;cycle=0;queued=0;max_queued=0;stalls=0;
  while(received<64)begin
   @(negedge clk);p_req_valid=sent<64;p_req_slot=selected_slot(sent);p_req_active=(sent%7)!=0;
   p_rsp_ready=(cycle%9)<5;cycle=cycle+1;
   @(posedge clk);
   if(p_req_valid && p_req_ready)begin sent=sent+1;queued=queued+1;if(queued>max_queued)max_queued=queued;end
   if(p_rsp_valid && !p_rsp_ready)stalls=stalls+1;
   if(p_rsp_valid && p_rsp_ready)begin
    if({p_rsp_slot,p_rsp_active,p_rsp_ended,p_rsp_frame,p_rsp_neighbor,p_rsp_fraction,p_rsp_next_cursor_q16,p_rsp_next_remainder}!==expected[received])
     $fatal(1,"ordered response %0d mismatch",received);
    received=received+1;queued=queued-1;
   end
  end
  @(negedge clk);p_req_valid=0;p_rsp_ready=0;
  if(sent!=64 || queued!=0 || max_queued<3 || stalls==0)$fatal(1,"insufficient overlap/stalls sent=%0d pending=%0d max=%0d stalls=%0d",sent,queued,max_queued,stalls);
  // Common reset cancels a queued result and clears the ordering FIFO.
  p_req_slot=0;p_req_active=1;p_req_valid=1;
  while(!p_req_ready)@(negedge clk);
  @(negedge clk);p_req_valid=0;
  if(parallel.count!=1)$fatal(1,"reset probe request not admitted");
  #1;reset_n=0;#1;if(p_rsp_valid || p_req_ready)$fatal(1,"reset exposed queued output");
  @(negedge clk);reset_n=1;@(negedge clk);
  if(parallel.count!=0 || p_rsp_valid)$fatal(1,"stale result survived common reset");
  $display("PASS four-lane/serial parity: 64 ordered operations, repeated/inactive slots, unequal latency, max in flight %0d, output stalls %0d",max_queued,stalls);$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
