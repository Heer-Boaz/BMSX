`timescale 1ns/1ps
// Real SYS packet master, physical multiplexed bus and actual PCRTC owner.
// GPU command actions and CPU memory routing are outside this fixture.
module gfx_pcrtc_sys_endpoint_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,req_write=0,config_ready=1;
 reg [31:0] req_addr=0,req_data=0;
 reg [3:0] req_be_n=0;
 reg [17:0] req_last=10;
 wire req_ready,rsp_valid,rsp_timeout,busy;
 wire [31:0] rsp_data,rsp_fault,master_out,endpoint_out;
 wire master_oe,endpoint_oe,ready_low,as_n,rd_n,wr_n;
 wire [3:0] be_n;
 tri [31:0] ad;tri1 ready_n;
 assign ad=master_oe ? master_out : 32'bz;
 assign ad=endpoint_oe ? endpoint_out : 32'bz;
 assign ready_n=ready_low ? 1'b0 : 1'bz;
 system_bus_master master(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_write(req_write),.req_addr(req_addr),.req_wdata(req_data),.req_be_n(req_be_n),
  .req_header_be_n(4'hf),.bus_busy(busy),.req_meta(32'd0),.req_data_timeout_enable(1'b1),
  .req_data_wait_last(req_last),.rsp_valid(rsp_valid),.rsp_rdata(rsp_data),.rsp_fault_code(rsp_fault),
  .rsp_timeout(rsp_timeout),.bus_ad_in(ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),
  .bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),.bus_ready_n(ready_n));
 wire cfg_valid,cfg_write;wire [4:0] cfg_index;wire [31:0] cfg_wdata,cfg_rdata;
 gfx_pcrtc_sys_endpoint endpoint(.clk(clk),.reset_n(reset_n),.cs_pcrtc_n(!busy),
  .bus_ad_in(ad),.bus_as_n(as_n),.bus_rd_n(rd_n),.bus_wr_n(wr_n),.bus_be_n(be_n),
  .bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),.bus_ready_drive_low(ready_low),
  .config_valid(cfg_valid),.config_write(cfg_write),.config_index(cfg_index),
  .config_write_word(cfg_wdata),.config_ready(config_ready),.config_read_word(cfg_rdata));
 wire restart;
 gfx_pcrtc_control beam(.clk(clk),.reset_n(reset_n),.access_valid(cfg_valid && config_ready),
  .access_write(cfg_write),.access_index(cfg_index),.access_wdata(cfg_wdata),.access_rdata(cfg_rdata),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(),.displayed_words(),
  .timing_restart(restart),.running(),.vblank_active(),.field(),.field_half_line(),.csr_word(),.imr_word());
 integer writes=0,restarts=0,transfers=0,stalled=0;
 always @(posedge clk) if(reset_n) begin
  if(master_oe && endpoint_oe)$fatal(1,"SYS bus contention");
  if(cfg_valid && !config_ready) stalled=stalled+1;
  if(cfg_valid && cfg_write && config_ready) writes=writes+1;
  if(restart)restarts=restarts+1;
 end
 task automatic transfer(input bit writing,input [31:0] addr,input [31:0] value,
  input [3:0] mask,input [17:0] last,input [31:0] expect_data,input [31:0] expect_fault,input bit expect_timeout);
  begin
   @(negedge clk);while(!req_ready)@(negedge clk);
   req_valid=1;req_write=writing;req_addr=addr;req_data=value;req_be_n=mask;req_last=last;
   @(negedge clk);req_valid=0;
   while(!rsp_valid)@(negedge clk);
   if(rsp_timeout!==expect_timeout || rsp_fault!==expect_fault || rsp_data!==expect_data)
    $fatal(1,"addr %h got data/fault/timeout %h %h %b expected %h %h %b",addr,rsp_data,rsp_fault,rsp_timeout,expect_data,expect_fault,expect_timeout);
   transfers=transfers+1;@(negedge clk);
  end
 endtask
 function automatic [31:0] addr(input integer n);
  addr=n<12 ? 32'h08010354+n*4 : 32'h080103ac+(n-12)*4;
 endfunction
 integer i,w_before,r_before,stall_before;reg [31:0] v;
 initial begin
  repeat(3)@(negedge clk);reset_n=1;repeat(3)@(negedge clk);
  for(i=0;i<22;i=i+1) begin
   v=32'h8312a550 ^ (32'h01010101*i);
   transfer(1,addr(i),v,0,10,0,0,0);
   transfer(0,addr(i),0,0,10,v,0,0);
  end
  if(writes!=22 || restarts!=8)$fatal(1,"write/restart count %0d %0d",writes,restarts);
  // Same retained timing word produces an accepted write but no restart.
  v=32'h8312a550 ^ (32'h01010101*19);r_before=restarts;
  transfer(1,addr(19),v,0,10,0,0,0);
  if(restarts!=r_before)$fatal(1,"unchanged timing word restarted");
  // Invalid byte enables and alignment are faults, not register writes.
  w_before=writes;
  transfer(1,addr(0),32'hffffffff,4'b1110,10,0,2,0);
  transfer(1,addr(0)+1,32'hffffffff,0,10,0,2,0);
  transfer(0,addr(0),0,0,10,32'h8312a550,0,0);
  if(writes!=w_before)$fatal(1,"invalid access wrote register");
  // A timed write with the owner not ready must not become visible later.
  config_ready=0;transfer(1,addr(0),32'hfedcba98,0,2,0,0,1);config_ready=1;
  transfer(0,addr(0),0,0,10,32'h8312a550,0,0);
  if(writes!=w_before || !stalled)$fatal(1,"withdrawn write committed");
  // A held write must commit once, not once per waiting DATA clock.
  stall_before=stalled;config_ready=0;
  fork
   transfer(1,addr(0),32'h01234567,0,20,0,0,0);
   begin wait(stalled>stall_before);repeat(3)@(negedge clk);config_ready=1;end
  join
  transfer(0,addr(0),0,0,10,32'h01234567,0,0);
  if(writes!=w_before+1)$fatal(1,"stalled write did not commit exactly once");
  // All four status words are answered; high words read zero.
  transfer(0,32'h080103d8,0,0,10,0,0,0);
  transfer(0,32'h080103dc,0,0,10,32'h00007f00,0,0);
  transfer(1,32'h080103dc,0,0,10,0,0,0);
  transfer(0,32'h080103dc,0,0,10,32'h00006000,0,0);
  transfer(1,32'h080103d4,32'h200,0,10,0,0,0);
  transfer(0,32'h08010354,0,0,10,0,0,0);
  transfer(0,32'h080103dc,0,0,10,32'h00007f00,0,0);
  transfer(0,32'h08010384,0,0,2,0,0,1);
  $display("PASS SYS master/config bank: %0d transfers, 22 word pairs, %0d writes, %0d timing restarts, faults and unaccepted timeout",transfers,writes,restarts);
  $finish;
 end
 initial begin #200000;$fatal(1,"timeout");end
endmodule
