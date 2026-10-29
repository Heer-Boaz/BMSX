`timescale 1ns/1ps
// Four-lane boundary review: concurrent load/request on different and same
// lanes, output blocking and reset of queued responses. This is not a complete
// APU playback or deadline test.
module apu_voice_cursor_lanes_boundary_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,load_valid=0,req_valid=0,rsp_ready=0,req_active=1;
 reg [3:0] load_slot=0,req_slot=0;reg signed [63:0] load_cursor_q16=0;
 wire load_ready,req_ready,rsp_valid,rsp_active,rsp_ended;wire [3:0] rsp_slot;
 wire [31:0] rsp_frame,rsp_neighbor;wire [15:0] rsp_fraction;wire signed [63:0] next_cursor;wire signed [31:0] next_rem;
 apu_voice_cursor_lanes d(.clk(clk),.reset_n(reset_n),.load_valid(load_valid),.load_ready(load_ready),.load_slot(load_slot),
  .load_cursor_q16(load_cursor_q16),.load_step_q16(64'sd65536),.load_remainder(32'sd0),.load_step_remainder(32'sd0),
  .load_frames(32'd16),.load_loop_start(32'd0),.load_loop_end(32'd0),.req_valid(req_valid),.req_ready(req_ready),
  .req_slot(req_slot),.req_active(req_active),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_slot(rsp_slot),
  .rsp_active(rsp_active),.rsp_ended(rsp_ended),.rsp_frame(rsp_frame),.rsp_neighbor(rsp_neighbor),.rsp_fraction(rsp_fraction),
  .rsp_next_cursor_q16(next_cursor),.rsp_next_remainder(next_rem));
 task automatic load(input [3:0] slot,input [31:0] frame);
  begin @(negedge clk);load_slot=slot;load_cursor_q16=$signed({16'd0,frame,16'd0});load_valid=1;
   while(!load_ready)@(negedge clk);@(negedge clk);load_valid=0;end
 endtask
 initial begin repeat(2)@(negedge clk);reset_n=1;load(0,3);load(2,7);
  // Different lanes independently admit load and voice work on one edge.
  @(negedge clk);load_valid=1;load_slot=1;load_cursor_q16=64'sd262144;req_valid=1;req_slot=0;#1;
  if(!load_ready||!req_ready)$fatal(1,"different lanes did not accept");@(negedge clk);load_valid=0;req_valid=0;
  while(!rsp_valid)@(negedge clk);if(rsp_slot!==0||rsp_frame!==3||rsp_neighbor!==4)$fatal(1,"slot0 response");
  // An outstanding result locks its own lane but not other lanes.
  @(negedge clk);load_valid=1;load_slot=4;req_valid=1;req_slot=4;#1;
  if(load_ready||req_ready)$fatal(1,"busy lane accepted load or work");
  load_slot=3;#1;if(!load_ready||req_ready)$fatal(1,"other lane incorrectly blocked");
  @(negedge clk);load_valid=0;req_valid=0;
  // Same-lane load has priority; slot request must remain unaccepted.
  @(negedge clk);load_valid=1;load_slot=2;load_cursor_q16=64'sd458752;req_valid=1;req_slot=2;#1;
  if(!load_ready||req_ready)$fatal(1,"same-lane priority");@(negedge clk);load_valid=0;#1;
  if(!req_ready)$fatal(1,"request not admitted after load");@(negedge clk);req_valid=0;
  repeat(3)begin @(negedge clk);if(!rsp_valid||rsp_slot!==0||rsp_frame!==3)$fatal(1,"head changed during stall");end
  rsp_ready=1;@(negedge clk);rsp_ready=0;
  while(!rsp_valid)@(negedge clk);if(rsp_slot!==2||rsp_frame!==7||rsp_neighbor!==8)$fatal(1,"slot2 ordering");
  // Reset cancels queued owner states and cannot leave a stale response.
  @(negedge clk);reset_n=0;#1;if(rsp_valid||req_ready||load_ready)$fatal(1,"reset did not suppress handshakes");
  @(negedge clk);reset_n=1;repeat(4)@(negedge clk);if(rsp_valid)$fatal(1,"stale response after reset");
  $display("PASS lane mapping: independent load/request, same-lane priority, blocked head ordering and reset");$finish;
 end
 initial begin #10000;$fatal(1,"timeout");end
endmodule
