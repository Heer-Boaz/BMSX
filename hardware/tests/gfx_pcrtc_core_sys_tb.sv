`timescale 1ns/1ps
// Actual CORE memory router, SYS master and PCRTC configuration endpoint.
// Main DRAM is not accessed by this MMIO fixture; CPU execution, supervisor
// switching and display-output clock crossing remain separate owners.
module gfx_pcrtc_core_sys_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,power_reset_n=0;
 reg [2:0] req_valid=0,req_write=0;
 reg [95:0] req_address=0,req_wdata=0,req_access=0;
 reg [8:0] req_size_bytes={3{3'd4}};
 wire [2:0] req_ready,rsp_valid,rsp_timeout;
 wire [95:0] rsp_rdata,rsp_fault_code;
 wire memory_ready,sys_bus_busy,cs_pcrtc_n;
 wire sys_as_n,sys_rd_n,sys_wr_n;wire [3:0] sys_be_n;
 tri [31:0] sys_ad,md;tri1 sys_ready_n;
 core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.clk(clk),.reset_n(reset_n),.power_reset_n(power_reset_n),
  .cpu_local_withdraw(1'b0),.cpu_local_withdrawn(),.req_valid(req_valid),.req_write(req_write),
  .req_hold(3'd0),.req_ready(req_ready),.req_address(req_address),.req_wdata(req_wdata),.req_access(req_access),
  .req_size_bytes(req_size_bytes),.req_bus_signals(24'd0),.req_data_timeout_enable(3'b111),
  .req_be_n(12'd0),.req_data_wait_last({3{18'd15}}),.rsp_valid(rsp_valid),.rsp_timeout(rsp_timeout),
  .rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.memory_ready(memory_ready),.block_locked(),
  .sys_bus_busy(sys_bus_busy),.sys_bus_request(),.sys_bus_owned(1'b1),.sys_ad(sys_ad),.sys_ready_n(sys_ready_n),
  .sys_as_n(sys_as_n),.sys_rd_n(sys_rd_n),.sys_wr_n(sys_wr_n),.sys_be_n(sys_be_n),
  .cs_rom_n(),.cs_io_n(),.cs_gpu_n(),.cs_pcrtc_n(cs_pcrtc_n),.cs_apu_n(),
  .ma(),.md(md),.mras_n(),.mwe_n(),.moe_n(),.mcas_n(),.local_valid(),.cart_valid(),
  .local_ready(1'b0),.cart_ready(1'b0),.local_write(),.cart_write(),.local_address(),.local_wdata(),
  .local_access(),.cart_address(),.cart_wdata(),.cart_access(),.cart_size_bytes(),.cart_data_timeout_enable(),
  .cart_data_wait_last(),.local_be_n(),.cart_be_n(),.local_bus_signals(),.cart_bus_signals(),
  .local_rsp_valid(1'b0),.cart_rsp_valid(1'b0),.cart_rsp_timeout(1'b0),
  .local_rdata(32'd0),.local_fault_code(32'd0),.cart_rdata(32'd0),.cart_fault_code(32'd0));
 wire [31:0] endpoint_out,cfg_rdata,cfg_wdata;wire endpoint_oe,ready_low,cfg_valid,cfg_write;
 wire [4:0] cfg_index;wire restart;
 assign sys_ad=endpoint_oe ? endpoint_out : 32'bz;
 assign sys_ready_n=ready_low ? 1'b0 : 1'bz;
 gfx_pcrtc_sys_endpoint endpoint(.clk(clk),.reset_n(reset_n && power_reset_n),.cs_pcrtc_n(cs_pcrtc_n),
  .bus_ad_in(sys_ad),.bus_as_n(sys_as_n),.bus_rd_n(sys_rd_n),.bus_wr_n(sys_wr_n),.bus_be_n(sys_be_n),
  .bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
  .config_valid(cfg_valid),.config_write(cfg_write),.config_index(cfg_index),.config_write_word(cfg_wdata),
  .config_ready(1'b1),.config_read_word(cfg_rdata));
 gfx_pcrtc_control beam(.clk(clk),.reset_n(reset_n && power_reset_n),.access_valid(cfg_valid),
  .access_write(cfg_write),.access_index(cfg_index),.access_wdata(cfg_wdata),.access_rdata(cfg_rdata),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(),.displayed_words(),
  .timing_restart(restart),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word());
 integer writes=0,restarts=0,byte_reads=0;
 always @(posedge clk) if(reset_n && power_reset_n) begin
  if(cfg_valid && cfg_write)writes=writes+1;
  if(restart)restarts=restarts+1;
  if(cfg_valid && !cfg_write && req_size_bytes[2:0]==1)begin
   if(sys_be_n!==0 || cfg_index!==0)$fatal(1,"U8 is not a full PCRTC word transaction");
   byte_reads=byte_reads+1;
  end
 end
 task automatic transfer(input bit writing,input [2:0] size,input [31:0] address,input [31:0] data,
  input [31:0] expected,input [31:0] fault);
  begin
   @(negedge clk);req_valid[0]=1;req_write[0]=writing;req_address[31:0]=address;req_wdata[31:0]=data;
   req_size_bytes[2:0]=size;req_access[31:0]=(writing ? 32'h2 : 32'h1) | (size==1 ? 32'h100 : size==2 ? 32'h200 : 32'h400);
   do @(posedge clk);while(!req_ready[0]);
   @(negedge clk);req_valid[0]=0;
   while(!rsp_valid[0])@(negedge clk);
   if(rsp_timeout[0] || rsp_fault_code[31:0]!==fault || rsp_rdata[31:0]!==expected)
    $fatal(1,"addr=%h size=%d result=%h fault=%h timeout=%b",address,size,rsp_rdata[31:0],rsp_fault_code[31:0],rsp_timeout[0]);
   @(negedge clk);
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);power_reset_n=1;reset_n=1;wait(memory_ready);repeat(2)@(negedge clk);
  transfer(0,4,32'h08010354,0,0,0);
  transfer(1,4,32'h08010354,32'h89abcdef,0,0);
  transfer(0,4,32'h08010354,0,32'h89abcdef,0);
  transfer(0,1,32'h08010354,0,32'hef,0);
  transfer(0,1,32'h08010355,0,0,2);
  transfer(0,2,32'h08010354,0,0,2);
  transfer(1,4,32'h080103c8,32'h12345678,0,0);
  transfer(0,4,32'h080103c8,0,32'h12345678,0);
  if(writes!=2 || restarts!=1 || byte_reads!=1)$fatal(1,"write/restart/U8 count %0d/%0d/%0d",writes,restarts,byte_reads);
  transfer(0,4,32'h080103dc,0,32'h7f00,0);
  transfer(1,4,32'h080103dc,0,0,0);
  transfer(0,4,32'h080103dc,0,32'h6000,0);
  transfer(1,4,32'h080103d4,32'h200,0,0);
  transfer(0,4,32'h08010354,0,0,0);
  transfer(0,4,32'h080103dc,0,32'h7f00,0);
  $display("PASS CORE -> SYS -> PCRTC: word/U8 accesses, timing restart, CSR reset and IMR, invalid widths/alignments");$finish;
 end
 initial begin #2000000;$fatal(1,"timeout");end
endmodule
