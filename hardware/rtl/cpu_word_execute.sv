`timescale 1ns/1ps
// Six BLua32 bitwise instructions, from an already decoded instruction to a
// Number writeback. The frame/image value owner handles the register and
// constant storage and returns the numeric read (a non-Number reads as NaN).
// This owner selects R or K and requests R[B] directly for BNOT. Reads are
// serialized, admitted with ready/valid and completed either on the request
// handshake or by a later independent response; the destination remains
// attached to the transaction under stalls.
// A response transfer corresponds to an accepted request, either on that
// handshake or afterward; the value owner holds a delayed response until taken.
// No VM tag encoding, exception policy, frame-top or cycle accounting is
// assumed. The caller dispatches only supported opcodes; select identifies them.
// A 1-cycle nominal instruction charge does not prove this path's timing.
// PicoRV32 also explicitly owns the register-read and execute handoff:
// https://github.com/YosysHQ/picorv32/blob/main/picorv32.v
module cpu_word_execute (
 input wire clk, reset_n,
 input wire req_valid, output wire req_ready, output wire select,
 input wire [5:0] req_opcode, input wire [13:0] req_a,
 input wire [14:0] req_b, input wire [31:0] req_rkb, req_rkc,
 output wire read_valid, input wire read_ready, output wire read_constant,
 output wire [14:0] read_index,
 input wire read_rsp_valid, output wire read_rsp_ready,
 input wire [63:0] read_rsp_number,
 output wire write_valid, input wire write_ready,
 output wire [13:0] write_index, output wire [63:0] write_number
);
 localparam [2:0] IDLE=0, SEND_B=1, WAIT_B=2, SEND_C=3, WAIT_C=4, SEND_ALU=5, WAIT_ALU=6;
 reg [2:0] state;
 reg [5:0] operations;
 reg [13:0] destination;
 reg [14:0] b_index;
 reg [31:0] rkb,rkc;
 reg unary;
 reg [63:0] left_number,right_number;
 wire [5:0] selected_operations={req_opcode==6'd34,req_opcode==6'd28,req_opcode==6'd27,
                                 req_opcode==6'd26,req_opcode==6'd25,req_opcode==6'd24};
 assign select=|selected_operations;
 assign req_ready=reset_n && state==IDLE && select;
 assign read_valid=state==SEND_B || state==SEND_C;
 wire b_port=state==SEND_B;
 wire [31:0] rk=b_port ? rkb : rkc;
 assign read_constant=b_port && unary ? 1'b0 : rk[31];
 assign read_index=b_port && unary ? b_index : rk[31] ? ~rk[14:0] : rk[14:0];
 // The consumer can accept the matching response throughout request issue;
 // readiness must not depend on the value owner's request-ready signal.
 assign read_rsp_ready=state==WAIT_B || state==WAIT_C || state==SEND_B || state==SEND_C;
 wire alu_ready;
 cpu_word_alu alu(.clk(clk),.reset_n(reset_n),.req_valid(state==SEND_ALU),.req_ready(alu_ready),
  .req_operations(operations),.req_destination(destination),.req_left_number(left_number),
  .req_right_number(right_number),.rsp_valid(write_valid),.rsp_ready(write_ready),
  .rsp_destination(write_index),.rsp_number(write_number));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;operations<=0;destination<=0;b_index<=0;rkb<=0;rkc<=0;unary<=0;
   left_number<=0;right_number<=0;
  end else case(state)
   IDLE: if(req_valid && req_ready) begin
    operations<=selected_operations;destination<=req_a;b_index<=req_b;rkb<=req_rkb;rkc<=req_rkc;
    unary<=req_opcode==6'd34;state<=SEND_B;
   end
   SEND_B: if(read_ready) begin
    if(read_rsp_valid)begin left_number<=read_rsp_number;state<=unary ? SEND_ALU : SEND_C;end
    else state<=WAIT_B;
   end
   WAIT_B: if(read_rsp_valid) begin left_number<=read_rsp_number;state<=unary ? SEND_ALU : SEND_C;end
   SEND_C: if(read_ready) begin
    if(read_rsp_valid)begin right_number<=read_rsp_number;state<=SEND_ALU;end
    else state<=WAIT_C;
   end
   WAIT_C: if(read_rsp_valid) begin right_number<=read_rsp_number;state<=SEND_ALU;end
   SEND_ALU: if(alu_ready) state<=WAIT_ALU;
   WAIT_ALU: if(write_valid && write_ready) state<=IDLE;
  endcase
 end
endmodule
