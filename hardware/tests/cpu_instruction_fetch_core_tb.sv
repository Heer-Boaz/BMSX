`timescale 1ns/1ps
// Actual CPU fetch -> CORE memory-router -> DRAM and SYS/flash pin models. Cartridge endpoint
// is a controllable bus peer for domain-strobe and body-fault checks; it does
// not stand in for the cartridge bridge or a complete CPU execution core.
module cpu_instruction_fetch_core_tb;
 reg clk=0;always #14.763 clk=~clk;
 reg reset_n=0,power_reset_n=0,fetch_valid=0,fetch_rsp_ready=0;
 reg [31:0] fetch_pc=0;reg [7:0] fetch_signals=0;
 wire fetch_ready,fetch_rsp_valid,fetch_wide,fetch_misaligned,fetch_fault;
 wire [31:0] out_pc,out_next,out_prefix,out_body,fetch_mem_address;
 wire [7:0] fetch_mem_signals;wire fetch_mem_valid;
 wire [2:0] req_valid={2'b0,fetch_mem_valid},req_write=0,req_hold=0;
 wire [95:0] req_address={64'd0,fetch_mem_address},req_wdata=0,req_access={64'd0,32'h00000401};
 wire [8:0] req_size_bytes={3'd4,3'd4,3'd4};
 wire [23:0] req_bus_signals={16'd0,fetch_mem_signals};
 wire [2:0] req_data_timeout_enable=0;wire [2:0] req_ready,rsp_valid,rsp_timeout;
 wire [11:0] req_be_n=0;wire [53:0] req_data_wait_last=0;
 wire [95:0] rsp_rdata,rsp_fault_code;
 cpu_instruction_fetch fetch(.clk(clk),.reset_n(reset_n),.req_valid(fetch_valid),.req_ready(fetch_ready),.req_pc(fetch_pc),
  .req_bus_signals(fetch_signals),.mem_valid(fetch_mem_valid),.mem_ready(req_ready[0]),.mem_address(fetch_mem_address),
  .mem_bus_signals(fetch_mem_signals),.mem_rsp_valid(rsp_valid[0]),.mem_rsp_data(rsp_rdata[31:0]),.mem_rsp_fault(rsp_fault_code[31:0]),
  .rsp_valid(fetch_rsp_valid),.rsp_ready(fetch_rsp_ready),.rsp_pc(out_pc),.rsp_next_pc(out_next),.rsp_prefix(out_prefix),.rsp_body(out_body),
  .rsp_wide(fetch_wide),.rsp_misaligned(fetch_misaligned),.rsp_bus_fault(fetch_fault));
 wire cpu_local_withdraw=0;wire cpu_local_withdrawn,memory_ready,block_locked,sys_bus_busy,sys_bus_request;
 wire sys_bus_owned=1;tri [31:0] sys_ad,md;tri1 sys_ready_n,sys_as_n,sys_rd_n,sys_wr_n;tri1 [3:0] sys_be_n;
 wire cs_rom_n,cs_io_n,cs_gpu_n,cs_pcrtc_n,cs_apu_n;wire [9:0] ma;wire mras_n,mwe_n,moe_n;wire [3:0] mcas_n;
 wire local_valid,cart_valid,local_write,cart_write;wire local_ready=1,cart_ready=1;
 wire [31:0] local_address,local_wdata,local_access,cart_address,cart_wdata,cart_access;
 wire [2:0] cart_size_bytes;wire cart_data_timeout_enable;wire [17:0] cart_data_wait_last;
 wire [3:0] local_be_n,cart_be_n;wire [7:0] local_bus_signals,cart_bus_signals;
 wire local_rsp_valid=0;wire [31:0] local_rdata=0,local_fault_code=0;
 reg cart_rsp_valid=0;reg [31:0] cart_rdata=0,cart_fault_code=0;wire cart_rsp_timeout=0;
 core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
 is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),.ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));
 wire [31:0] rom_ad_out;wire rom_oe,rom_ready;wire [21:0] flash_address;
 wire flash_ce_n,flash_oe_n;tri [15:0] flash_data;reg [15:0] flash_word;
 assign sys_ad=rom_oe ? rom_ad_out : 32'bz;
 assign sys_ready_n=rom_ready ? 1'b0 : 1'bz;
 assign #(70,70,20) flash_data=!flash_ce_n && !flash_oe_n ? flash_word : 16'bz;
 always @* case(flash_address)
  0: flash_word=16'h047b;1: flash_word=16'h2301;
  4: flash_word=16'h0099;5: flash_word=16'h2301;
  6: flash_word=16'h00cc;7: flash_word=16'h7856;
  default: flash_word=0;
 endcase
 rom_sys_endpoint rom(.clk(clk),.reset_n(reset_n),.cs_rom_n(cs_rom_n),.bus_ad_in(sys_ad),
  .bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),.bus_wr_n(sys_wr_n),.bus_be_n(sys_be_n),
  .bus_ad_out(rom_ad_out),.bus_ad_oe(rom_oe),.bus_ready_drive_low(rom_ready),
  .flash_data(flash_data),.flash_address(flash_address),.flash_ce_n(flash_ce_n),.flash_oe_n(flash_oe_n));
 integer cart_reads=0;
 always @(posedge clk) begin
  cart_rsp_valid<=0;
  if(reset_n && cart_valid && cart_ready) begin
   if(cart_bus_signals!==8'h0c || cart_write || cart_size_bytes!==4 || cart_access!==32'h401)$fatal(1,"cart fetch flags/width");
   cart_reads<=cart_reads+1;cart_rsp_valid<=1;
   cart_rdata<=32'h23010099;cart_fault_code<=cart_address==32'h10000400 ? 1 : 0;
  end
 end
 task automatic submit(input [31:0] address,input [7:0] flags);
  begin @(negedge clk);while(!fetch_ready)@(negedge clk);fetch_valid=1;fetch_pc=address;fetch_signals=flags;
   @(negedge clk);fetch_valid=0;fetch_pc=0;fetch_signals=0;end
 endtask
 task automatic consume;
  begin @(negedge clk);fetch_rsp_ready=1;@(negedge clk);fetch_rsp_ready=0;end
 endtask
 initial begin
  memory.words[20'h08000]=32'h2301047b;memory.words[20'h08002]=32'h23010099;memory.words[20'h08003]=32'h785600cc;
  #100;power_reset_n=1;#300000;reset_n=1;wait(memory_ready);
  submit(32'h08020000,0);wait(fetch_rsp_valid);
  if(out_pc!==32'h08020000||out_next!==32'h08020004||out_body!==32'h7b040123||fetch_wide||fetch_fault||fetch_misaligned)$fatal(1,"DRAM normal");consume();
  submit(32'h08020008,0);wait(fetch_rsp_valid);
  if(out_pc!==32'h08020008||out_next!==32'h08020010||out_prefix!==32'h99000123||out_body!==32'hcc005678||!fetch_wide||fetch_fault)$fatal(1,"DRAM WIDE");consume();
  submit(32'h00000000,0);wait(fetch_rsp_valid);
  if(out_pc!==0||out_next!==4||out_body!==32'h7b040123||fetch_wide||fetch_fault)$fatal(1,"SYS flash normal");consume();
  submit(32'h00000008,0);wait(fetch_rsp_valid);
  if(out_pc!==8||out_next!==16||out_prefix!==32'h99000123||out_body!==32'hcc005678||!fetch_wide||fetch_fault)$fatal(1,"SYS flash WIDE");consume();
  submit(32'h100003fc,8'h0c);wait(fetch_rsp_valid);
  if(!fetch_fault||!fetch_wide||out_pc!==32'h100003fc||cart_reads!==2)$fatal(1,"cartridge body fault/domain");consume();
  $display("PASS fetch through actual CORE memory router, DRAM pins and SYS/flash pins; BE WIDE; cartridge peer preserves bound socket flags and body fault");$finish;
 end
 initial begin #1000000;$fatal(1,"timeout");end
endmodule
