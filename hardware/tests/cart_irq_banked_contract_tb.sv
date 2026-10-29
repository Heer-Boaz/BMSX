`timescale 1ns/1ps
// Book III central IRQ contract through the actual cartridge pin receiver and
// CORE IRQ bank. CASE 0 verifies fast physical rearm after central ACK. CASE 1
// explores a stronger causal assumption: a pin edge just before ACK is
// treated as already centrally pending. Book III does not specify pin-to-FLAGS
// latency, so CASE 1 is a race experiment, not an established conformance rule.
// CASE 2 verifies that multiple source assertions while central pending is
// clear result in at least one event, without requiring a count of the events.
// CASE 3 asserts a second edge shortly after an accepted ACK, while the first
// event is already in FLAGS. The preceding inactive interval is one clock.
// The offset is an ideal digital stimulus, not a qualified ASIC timing limit.
// CASE 4 observes whether an isolated, already-released short digital pulse
// is retained. This is a receiver-design comparison, not a specified minimum
// cartridge pulse width or evidence of the physical input's pulse limit.
// These tests do not qualify fabricated ASIC pulse widths or metastability.
module cart_irq_banked_contract_tb;
 reg clk=0;always #14.76285 clk=!clk;
 reg reset_n=0;reg [1:0] irq_cart_n=3,dreq_read=0,dreq_write=0;
 wire [31:0] irq_raise;wire [15:0] dma_requests;
 reg local_valid=0,local_write=0;reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid;wire [31:0] local_rdata,local_fault_code;
 cart_pin_events pins(.clk(clk),.reset_n(reset_n),.irq_cart_n(irq_cart_n),
   .dreq_read(dreq_read),.dreq_write(dreq_write),.irq_raise(irq_raise),.dma_requests(dma_requests));
 core_local_dma_irq unit(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),
   .local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),
   .local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),
   .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
   .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
   .system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),
   .system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise(irq_raise),.user_irq_raise(32'd0),.irq_line(),
   .trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(1'b0),.leave_supervisor(1'b0),
   .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(dma_requests),.port_address(32'd0),
   .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
   .transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),
   .req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),
   .req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));
 integer which=0;
 initial begin #100000;$fatal(1,"watchdog");end
 task automatic write_ack;
  begin
   @(negedge clk);local_valid=1;local_write=1;local_address=32'h08000004;local_wdata=32'h200;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0) $fatal(1,"unexpected ACK fault");
  end
 endtask
 task automatic read_flags(input [31:0] expected);
  begin
   @(negedge clk);local_valid=1;local_write=0;local_address=32'h08000000;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_rdata!==expected || local_fault_code!==0)
    $fatal(1,"FLAGS expected %h observed %h",expected,local_rdata);
  end
 endtask
 initial begin
  if(!$value$plusargs("CASE=%d",which)) which=0;
  repeat(3) @(negedge clk);reset_n=1;
  if(which==0) begin
   @(negedge clk);irq_cart_n[0]=0;repeat(8) @(negedge clk);read_flags(32'h200);
   write_ack();read_flags(0);
   // Card ACK clears its own source; it independently triggers again after
   // only one full CORE clock of high level. No minimum is in Book III.
   @(negedge clk);irq_cart_n[0]=1;@(negedge clk);irq_cart_n[0]=0;
   repeat(9) @(negedge clk);read_flags(32'h200);
  end else if(which==3) begin
   // Deliver the first event, then accept central ACK on the next edge.
   // A second card event occurs 0.5 ns after ACK and after one high clock.
   // Its pending bit must not be dismissed as part of the cleared event.
   @(negedge clk);irq_cart_n[0]=0;
   wait(irq_raise[9]===1);@(posedge clk);#0.5;
   if(unit.pending[9]!==1) $fatal(1,"first event not centrally pending before ACK");
   irq_cart_n[0]=1;local_valid=1;local_write=1;
   local_address=32'h08000004;local_wdata=32'h200;
   do @(posedge clk);while(!local_ready);
   #0.5;irq_cart_n[0]=0;
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   repeat(9) @(negedge clk);read_flags(32'h200);
  end else if(which==4) begin
   // This 3 ns pulse is completely between destination clock edges. There is
   // no assertion that a real pin or cartridge can produce or recognize it.
   @(negedge clk);#1;irq_cart_n[0]=0;#3;irq_cart_n[0]=1;
   repeat(9) @(negedge clk);read_flags(32'h200);
  end else if(which==1) begin
   // Race experiment with a stronger causal assumption than Book III:
   // the physical pin edge is counted as pending before it has synchronized.
   @(negedge clk);irq_cart_n[0]=0;local_valid=1;local_write=1;
   local_address=32'h08000004;local_wdata=32'h200;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   repeat(9) @(negedge clk);read_flags(0);
  end else begin
   // Both source assertions fit before the destination samples either.
   // Coalescence permits one pending bit, but not losing both assertions.
   @(negedge clk);#1;irq_cart_n[0]=0;#3;irq_cart_n[0]=1;#3;irq_cart_n[0]=0;
   repeat(9) @(negedge clk);read_flags(32'h200);
  end
  $display("PASS cartridge IRQ bank contract case %0d",which);$finish;
 end
endmodule
