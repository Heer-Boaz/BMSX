`timescale 1ns/1ps
// Four independent phase lanes share the sixteen architectural voices. Lane is
// slot[1:0], local voice is slot[3:2]; each lane retains four contexts. The
// four-entry order FIFO returns accepted requests in submission order even if
// a later lane finishes first. Each lane commits its own state only when its
// descriptor is consumed. Output backpressure therefore cannot reorder or
// discard a slot. Load and requests to a busy lane wait on that lane.
// This adds actual parallel datapaths, not a 768-clock or whole-APU guarantee.
// MAME and MiSTer SPUs keep per-voice state; the issue/return ordering here is
// an ASIC implementation choice, not a change to the software format.
module apu_voice_cursor_lanes (
 input wire clk,reset_n,
 input wire load_valid,output wire load_ready,input wire [3:0] load_slot,
 input wire signed [63:0] load_cursor_q16,load_step_q16,
 input wire signed [31:0] load_remainder,load_step_remainder,
 input wire [31:0] load_frames,load_loop_start,load_loop_end,
 input wire req_valid,output wire req_ready,input wire [3:0] req_slot,input wire req_active,
 output wire rsp_valid,input wire rsp_ready,
 output wire [3:0] rsp_slot,output wire rsp_active,rsp_ended,
 output wire [31:0] rsp_frame,rsp_neighbor,output wire [15:0] rsp_fraction,
 output wire signed [63:0] rsp_next_cursor_q16,output wire signed [31:0] rsp_next_remainder
);
 wire [3:0] lane_load_ready,lane_req_ready,lane_rsp_valid,lane_rsp_active,lane_rsp_ended;
 wire [3:0] lane_rsp_slot[0:3];
 wire [31:0] lane_rsp_frame[0:3],lane_rsp_neighbor[0:3];
 wire [15:0] lane_rsp_fraction[0:3];
 wire signed [63:0] lane_rsp_next_cursor[0:3];
 wire signed [31:0] lane_rsp_next_remainder[0:3];
 reg [1:0] queue[0:3];reg [1:0] head,tail;reg [2:0] count;
 wire [1:0] selected=queue[head];
 wire pop=rsp_valid && rsp_ready;
 wire space=count<4 || pop;
 assign load_ready=lane_load_ready[load_slot[1:0]];
 assign req_ready=reset_n && space && lane_req_ready[req_slot[1:0]];
 assign rsp_valid=reset_n && count!=0 && lane_rsp_valid[selected];
 assign rsp_slot={lane_rsp_slot[selected][1:0],selected};
 assign rsp_active=lane_rsp_active[selected];
 assign rsp_ended=lane_rsp_ended[selected];
 assign rsp_frame=lane_rsp_frame[selected];
 assign rsp_neighbor=lane_rsp_neighbor[selected];
 assign rsp_fraction=lane_rsp_fraction[selected];
 assign rsp_next_cursor_q16=lane_rsp_next_cursor[selected];
 assign rsp_next_remainder=lane_rsp_next_remainder[selected];
 genvar i;
 generate for(i=0;i<4;i=i+1) begin: lane
  apu_voice_cursor #(.SLOT_BITS(2)) cursor(
   .clk(clk),.reset_n(reset_n),
   .load_valid(load_valid && load_slot[1:0]==i),.load_ready(lane_load_ready[i]),
   .load_slot({2'b00,load_slot[3:2]}),.load_cursor_q16(load_cursor_q16),.load_step_q16(load_step_q16),
   .load_remainder(load_remainder),.load_step_remainder(load_step_remainder),
   .load_frames(load_frames),.load_loop_start(load_loop_start),.load_loop_end(load_loop_end),
   .req_valid(req_valid && space && req_slot[1:0]==i),.req_ready(lane_req_ready[i]),
   .req_slot({2'b00,req_slot[3:2]}),.req_active(req_active),
   .rsp_valid(lane_rsp_valid[i]),.rsp_ready(count!=0 && selected==i && rsp_ready),
   .rsp_slot(lane_rsp_slot[i]),.rsp_active(lane_rsp_active[i]),.rsp_ended(lane_rsp_ended[i]),
   .rsp_frame(lane_rsp_frame[i]),.rsp_neighbor(lane_rsp_neighbor[i]),.rsp_fraction(lane_rsp_fraction[i]),
   .rsp_next_cursor_q16(lane_rsp_next_cursor[i]),.rsp_next_remainder(lane_rsp_next_remainder[i])
  );
 end endgenerate
 integer n;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   head<=0;tail<=0;count<=0;
   for(n=0;n<4;n=n+1)queue[n]<=0;
  end else begin
   if(req_valid && req_ready) begin queue[tail]<=req_slot[1:0];tail<=tail+1'b1;end
   if(pop) head<=head+1'b1;
   case({req_valid && req_ready,pop})
    2'b10:count<=count+1'b1;
    2'b01:count<=count-1'b1;
   endcase
  end
 end
endmodule
