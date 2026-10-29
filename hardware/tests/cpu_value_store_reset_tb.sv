`timescale 1ns/1ps
// The external slot-memory must cancel its pending response on the same reset.
// This test verifies the store owner, not a physical SRAM reset protocol.
module cpu_value_store_reset_tb;
reg clk=0;always #5 clk=~clk;
reg reset_n=0,rv=0,rspr=0,raw=0,mready=0,mrsp=0;wire rr,rvalid,rawready,mv,mw,mrspr;wire [63:0] payload;wire isnum;wire [31:0] addr;wire [67:0] wd;
cpu_value_store d(.clk(clk),.reset_n(reset_n),.frame_base(32'd10),.constant_base(32'd20),.slot_read_valid(rv),.slot_read_ready(rr),.slot_read_constant(1'b0),.slot_read_index(15'd1),.slot_rsp_valid(rvalid),.slot_rsp_ready(rspr),.slot_rsp_is_number(isnum),.slot_rsp_payload(payload),.slot_write_valid(1'b0),.slot_write_ready(),.slot_write_index(14'd0),.slot_write_number(64'd0),.raw_valid(raw),.raw_ready(rawready),.raw_write(1'b1),.raw_constant(1'b0),.raw_index(32'd3),.raw_kind(4'd2),.raw_payload(64'd7),.raw_rsp_valid(),.raw_rsp_ready(1'b1),.raw_rsp_kind(),.raw_rsp_payload(),.mem_valid(mv),.mem_ready(mready),.mem_write(mw),.mem_address(addr),.mem_wdata(wd),.mem_rsp_valid(mrsp),.mem_rsp_ready(mrspr),.mem_rsp_data(68'h33ff0000000000000),.mem_fault_valid(1'b0),.raw_fault(),.slot_write_fault(),.slot_read_fault());
initial begin repeat(2)@(negedge clk);reset_n=1;rv=1;mready=1;rspr=1;@(negedge clk);rv=0;mready=0;if(!d.pending)$fatal(1,"not pending");mrsp=1;reset_n=0;#1;if(mv||rvalid||rr||mrspr||d.pending)$fatal(1,"reset did not clear state");@(negedge clk);mrsp=0;reset_n=1;raw=1;mready=1;#1;if(!rawready||!mw||addr!=13||wd!=68'h20000000000000007)$fatal(1,"new write after reset");@(negedge clk);raw=0;mready=0;rv=1;@(negedge clk);#1;if(!d.held)$fatal(1,"stalled request not held");reset_n=0;#1;if(mv||d.held)$fatal(1,"reset did not clear held");@(negedge clk);reset_n=1;rv=0;raw=1;mready=1;#1;if(!rawready||!mw||addr!=13)$fatal(1,"post reset arbitration");$display("PASS pending and held state cleared on reset with backend cancellation");$finish;end
initial begin #10000;$fatal(1,"timeout");end
endmodule
