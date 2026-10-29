`timescale 1ns/1ps
// Real SYS master, existing timed ROM owner and two x16 flash fixtures on a
// shared tri-state bus. The private HEADER is injected by the native producer;
// this test does not implement the native CPU or assert guest access control.
module rom_program_pair_tb;
 localparam real SYS_PERIOD=1000000000.0/33868800.0;
 reg clk=0,reset_n=0;always #(SYS_PERIOD/2.0) clk=~clk;
 reg req_valid=0,req_write=0;reg [31:0] req_addr=0;reg [3:0] header=4'hf;
 wire req_ready,rsp_valid,rsp_timeout,busy;wire [31:0] rsp_data,rsp_fault;
 wire [31:0] mo,eo;wire moe,eoe,ready_low,as_n,rd_n,wr_n;wire [3:0] be_n;
 tri [31:0] bus;tri1 ready_n;tri [15:0] data;
 wire [21:0] addr;wire guest_ce_n,native_ce_n;
 assign bus=moe ? mo : 32'bz;assign bus=eoe ? eo : 32'bz;assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master master(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(req_write),.req_addr(req_addr),.req_wdata(32'b0),.req_be_n(4'b0),.req_header_be_n(header),
  .bus_busy(busy),.req_meta(32'b0),.req_data_timeout_enable(1'b1),.req_data_wait_last(18'd15),
  .rsp_valid(rsp_valid),.rsp_rdata(rsp_data),.rsp_fault_code(rsp_fault),.rsp_timeout(rsp_timeout),
  .bus_ad_in(bus),.bus_ad_out(mo),.bus_ad_oe(moe),.bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),
  .bus_be_n(be_n),.bus_ready_n(ready_n));
 rom_program_pair_candidate dut(.clk(clk),.reset_n(reset_n),.cs_rom_n(1'b0),.bus_ad_in(bus),
  .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ad_out(eo),.bus_ad_oe(eoe),
  .bus_ready_drive_low(ready_low),.flash_data(data),.flash_address(addr),.guest_ce_n(guest_ce_n),.native_ce_n(native_ce_n));
 // Distinct per-bank fixture values. Each flash enters high impedance 20 ns
 // after CE deasserts and supplies a stable halfword 70 ns after assertion.
 assign #(70,70,20) data=reset_n && !guest_ce_n ? (16'h1000 ^ addr[15:0] ^ {addr[21:16],10'b0}) : 16'bz;
 assign #(70,70,20) data=reset_n && !native_ce_n ? (16'h8000 ^ addr[15:0] ^ {addr[21:16],10'b0}) : 16'bz;
 realtime last_off=0;integer bank=-1,guest_reads=0,native_reads=0;
 always @(negedge guest_ce_n) begin
  if(!native_ce_n) $fatal(1,"both flash devices selected");
  if(bank==1 && $realtime-last_off<20.0) $fatal(1,"private to guest turnaround too short");
  bank=0;guest_reads=guest_reads+1;
 end
 always @(negedge native_ce_n) begin
  if(!guest_ce_n) $fatal(1,"both flash devices selected");
  if(bank==0 && $realtime-last_off<20.0) $fatal(1,"guest to private turnaround too short");
  bank=1;native_reads=native_reads+1;
 end
 always @(posedge guest_ce_n or posedge native_ce_n) last_off=$realtime;
 task transfer(input [3:0] h,input [31:0] a,input bit wr,input [31:0] expected,input [31:0] fault);
  begin
   @(negedge clk);while(!req_ready)@(negedge clk);
   header=h;req_addr=a;req_write=wr;req_valid=1;
   @(negedge clk);req_valid=0;
   while(!rsp_valid)@(negedge clk);
   if(rsp_timeout || rsp_fault!==fault || rsp_data!==expected)
    $fatal(1,"header=%h addr=%h got=%h fault=%h timeout=%b",h,a,rsp_data,rsp_fault,rsp_timeout);
  end
 endtask
 integer bit_index;reg [15:0] guest_word,native_word;
 initial begin
  repeat(4)@(negedge clk);reset_n=1;repeat(6)@(negedge clk);
  transfer(4'hf,0,0,32'h10011000,0);
  transfer(4'hc,0,0,32'h80018000,0);
  transfer(4'hf,4,0,32'h10031002,0);
  transfer(4'hc,4,0,32'h80038002,0);
  transfer(4'hf,32'h00600000,0,32'hd001d000,0);
  transfer(4'hc,32'h00600000,0,32'h40014000,0);
  for(bit_index=16;bit_index<22;bit_index=bit_index+1) begin
   guest_word=16'h1000 ^ (16'h0400 << (bit_index-16));
   native_word=16'h8000 ^ (16'h0400 << (bit_index-16));
   transfer(4'hf,32'd1 << (bit_index+1),0,{guest_word ^ 16'd1,guest_word},0);
   transfer(4'hc,32'd1 << (bit_index+1),0,{native_word ^ 16'd1,native_word},0);
  end
  transfer(4'hf,32'h00800000,0,0,0);
  transfer(4'hf,4,1,0,1);
  if(guest_reads!=18 || native_reads!=18) $fatal(1,"unexpected device reads guest=%0d native=%0d",guest_reads,native_reads);
  if(!guest_ce_n || !native_ce_n) $fatal(1,"flash selected after completed word");
  $display("PASS private/guest ROM bank selection: all high address bits and alternating banks, 70ns access/20ns release, guest upper zero region and rejected write");$finish;
 end
 initial begin #100000; $fatal(1,"timeout");end
endmodule
