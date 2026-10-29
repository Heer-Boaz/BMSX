`timescale 1ns/1ps
// Actual CORE local decode, DMA channel banks and IRQ pending/mask/ACK
// exercise shared ownership through the physical DRAM pin model.
module system_supervisor_integration_tb;
    reg clk=0; always #14.763 clk=!clk;
    reg reset_n=0,power_reset_n=0;
    wire trigger_inhibit,admission_inhibit,enter_supervisor,leave_supervisor;
    wire supervisor_boundary_ready,local_boundary_ready;
    reg [15:0] request_lines=0;
    reg [31:0] external_irq_raise=0,user_irq_raise=0,port_address=0;
    wire irq_line,block_active,active_channel,owns_read_port,owns_write_port;
    wire [31:0] active_read_address,active_write_address;
    wire transport_failed,transport_write_in_doubt;
    wire cpu_local_withdraw; reg cpu_hold=0;
    wire cpu_local_withdrawn;
    reg cpu_valid=0,cpu_write=0;
    reg [31:0] cpu_address=0,cpu_wdata=0,cpu_access=0;
    reg [2:0] cpu_size=4;
    wire dma_valid,dma_write,dma_hold,dma_ready;
    wire [31:0] dma_address,dma_wdata,dma_access;
    wire [2:0] dma_size;
    wire [3:0] dma_be;
    wire [7:0] dma_signals;
    wire dma_timeout_enable;
    wire [17:0] dma_wait_last;
    wire [2:0] rsp_valid,rsp_timeout,req_ready;
    wire [95:0] rsp_rdata,rsp_fault_code;
    wire local_valid,cart_valid,local_write,cart_write;
    wire local_ready,local_rsp_valid;
    wire cart_ready=1'b0,cart_rsp_valid=1'b0,cart_rsp_timeout=1'b0;
    wire [31:0] local_address,local_wdata,local_access,local_rdata,local_fault_code,cart_address,cart_wdata,cart_access;
    wire [31:0] cart_rdata=0,cart_fault_code=0;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable;
    wire [17:0] cart_data_wait_last;
    wire [3:0] local_be_n,cart_be_n;
    wire [7:0] local_bus_signals,cart_bus_signals;
    wire other_valid,other_write; wire [31:0] other_address,other_wdata,other_access;
    wire [3:0] other_be_n;wire [7:0] other_bus_signals;
    reg other_rsp_valid=0;wire other_ready=1;reg [31:0] other_rdata=0;wire [31:0] other_fault_code=0;
    wire debug_byte_valid;wire [7:0] debug_byte;
    reg debug_byte_ready=0;
    wire system_valid,system_write,system_ready,system_rsp_valid;
    wire [31:0] system_address,system_wdata,system_rdata,system_fault_code;
    core_local_dma_irq unit (
        .clk(clk), .reset_n(reset_n && power_reset_n), .local_valid(local_valid), .local_write(local_write),
        .local_address(local_address), .local_wdata(local_wdata), .local_access(local_access),
        .local_be_n(local_be_n), .local_bus_signals(local_bus_signals),
        .local_ready(local_ready), .local_rsp_valid(local_rsp_valid), .local_rdata(local_rdata), .local_fault_code(local_fault_code),
        .other_valid(other_valid), .other_write(other_write), .other_address(other_address), .other_wdata(other_wdata),
        .other_access(other_access), .other_be_n(other_be_n), .other_bus_signals(other_bus_signals),
        .other_ready(other_ready), .other_rsp_valid(other_rsp_valid), .other_rdata(other_rdata), .other_fault_code(other_fault_code),
        .system_valid(system_valid), .system_write(system_write), .system_address(system_address), .system_wdata(system_wdata),
        .system_ready(system_ready), .system_rsp_valid(system_rsp_valid), .system_rdata(system_rdata), .system_fault_code(system_fault_code),
        .external_irq_raise(external_irq_raise), .user_irq_raise(user_irq_raise), .irq_line(irq_line), .trigger_inhibit(trigger_inhibit),
        .admission_inhibit(admission_inhibit), .enter_supervisor(enter_supervisor),
        .leave_supervisor(leave_supervisor), .supervisor_boundary_ready(supervisor_boundary_ready),
        .local_boundary_ready(local_boundary_ready),
        .request_lines(request_lines), .port_address(port_address),
        .owns_read_port(owns_read_port), .owns_write_port(owns_write_port), .block_active(block_active),
        .active_channel(active_channel), .active_read_address(active_read_address), .active_write_address(active_write_address),
        .transport_failed(transport_failed), .transport_write_in_doubt(transport_write_in_doubt),
        .req_valid(dma_valid), .req_ready(dma_ready), .req_write(dma_write), .req_hold(dma_hold),
        .req_address(dma_address), .req_wdata(dma_wdata), .req_access(dma_access),
        .req_size_bytes(dma_size), .req_be_n(dma_be), .req_bus_signals(dma_signals),
        .req_data_timeout_enable(dma_timeout_enable), .req_data_wait_last(dma_wait_last),
        .rsp_valid(rsp_valid[1]), .rsp_timeout(rsp_timeout[1]), .rsp_rdata(rsp_rdata[63:32]));
    assign dma_ready=req_ready[1];
    wire [2:0] req_valid={1'b0,dma_valid,cpu_valid},req_write={1'b0,dma_write,cpu_write},
        req_hold={1'b0,dma_hold,cpu_hold};
    wire [95:0] req_address={32'd0,dma_address,cpu_address},req_wdata={32'd0,dma_wdata,cpu_wdata},
        req_access={32'd0,dma_access,cpu_access};
    wire [8:0] req_size_bytes={3'd4,dma_size,cpu_size};
    wire [23:0] req_bus_signals={8'd0,dma_signals,8'd0};
    wire [2:0] req_data_timeout_enable={1'b0,dma_timeout_enable,1'b0};
    wire [11:0] req_be_n={4'd0,dma_be,4'd0};
    wire [53:0] req_data_wait_last={18'd0,dma_wait_last,18'd0};
    wire memory_ready,block_locked,sys_bus_busy,sys_bus_request;
    wire sys_bus_owned=1'b1;
    tri [31:0] sys_ad,md;
    tri1 sys_ready_n,sys_as_n,sys_rd_n,sys_wr_n;
    tri1 [3:0] sys_be_n;
    wire cs_rom_n,cs_io_n,cs_gpu_n,cs_pcrtc_n,cs_apu_n;
    wire [9:0] ma;
    wire mras_n,mwe_n,moe_n;
    wire [3:0] mcas_n;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory(.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    reg cpu_user_mode=1,supervisor_edge=0,cpu_nmi_accepted=0,reset_taken=0;
    reg geo_quiescent=0,imgdec_quiescent=0,gpu_quiescent=0;
    reg [31:0] cpu_cause=32'h11223344,cpu_epc=32'h55667788,cpu_bad_address=32'h99aabbcc,
               cpu_lua_reason=32'hdeadbeef,cpu_domain=1;
    wire gpu_control_quiesce,gpu_boundary_quiesce,producer_quiesce,apu_voice_hold,cpu_boundary_hold;
    wire nmi_request,reset_request,gpu_enter,gpu_leave;
    wire [31:0] status_word;
    system_supervisor sys(.clk(clk),.reset_n(reset_n && power_reset_n),
       .access_valid(system_valid),.access_write(system_write),.access_address(system_address),.access_wdata(system_wdata),
       .access_ready(system_ready),.response_valid(system_rsp_valid),.response_data(system_rdata),.response_fault(system_fault_code),
       .diagnostic_valid(debug_byte_valid),.diagnostic_data(debug_byte),.diagnostic_ready(debug_byte_ready),
       .cpu_user_mode(cpu_user_mode),.cpu_cause(cpu_cause),.cpu_epc(cpu_epc),.cpu_bad_address(cpu_bad_address),
       .cpu_lua_reason(cpu_lua_reason),.cpu_domain(cpu_domain),.supervisor_edge(supervisor_edge),
       .cpu_nmi_accepted(cpu_nmi_accepted),.reset_taken(reset_taken),.geo_quiescent(geo_quiescent),
       .imgdec_quiescent(imgdec_quiescent),.gpu_quiescent(gpu_quiescent),.dma_local_boundary_ready(supervisor_boundary_ready),
       .producer_quiesce(producer_quiesce),.gpu_control_quiesce(gpu_control_quiesce),.gpu_boundary_quiesce(gpu_boundary_quiesce),
       .dma_trigger_inhibit(trigger_inhibit),.dma_admission_inhibit(admission_inhibit),.apu_voice_hold(apu_voice_hold),
       .cpu_boundary_hold(cpu_boundary_hold),.cpu_local_withdraw(cpu_local_withdraw),.enter_supervisor(enter_supervisor),
       .leave_supervisor(leave_supervisor),.gpu_enter(gpu_enter),.gpu_leave(gpu_leave),.nmi_request(nmi_request),
       .reset_request(reset_request),.status_word(status_word));
    always @(posedge clk) begin
      other_rsp_valid<=other_valid && other_ready;
      if(other_valid && other_ready) begin
        if(other_address!==32'h08000024) $fatal(1,"wrong address routed to other LOCAL owner");
        other_rdata<=32'h1234abcd;
      end
    end
    integer enter_count=0,leave_count=0,gpu_enter_count=0,gpu_leave_count=0;
    reg time_carry_sample_seen=0;
    always @(posedge clk) if(system_valid && system_ready && !system_write &&
        system_address==32'h08010228 && sys.timebase.fraction==18'd169340)
        time_carry_sample_seen<=1;
    always @(posedge clk) if(reset_n && power_reset_n) begin
      if(enter_supervisor) enter_count<=enter_count+1;
      if((sys.activation_pending || sys.gpu_activation_pending || enter_supervisor || gpu_enter) && status_word[2])
        $fatal(1,"STATUS published RESUMABLE before context owners consumed ENTER");
      if(leave_supervisor) begin
        if(status_word[0]!==1 || status_word[2]!==1)
          $fatal(1,"STATUS dropped ACTIVE/RESUMABLE before IRQ/DMA restore edge");
        leave_count<=leave_count+1;
      end
      if(gpu_enter) begin
        if(enter_count!=gpu_enter_count+1) $fatal(1,"GPU entered before IRQ/DMA context");
        gpu_enter_count<=gpu_enter_count+1;
      end
      if(gpu_leave) begin
        if(leave_count!=gpu_leave_count) $fatal(1,"IRQ/DMA context left before GPU");
        gpu_leave_count<=gpu_leave_count+1;
      end
    end
    task automatic transfer(input bit writing,input [31:0] addr,data,expected,expected_fault);
      integer guard;
      begin
       @(negedge clk);cpu_valid=1;cpu_write=writing;cpu_address=addr;cpu_wdata=data;
       cpu_size=4;cpu_access=writing ? 32'h402 : 32'h401;guard=0;
       do begin @(posedge clk);guard=guard+1;if(guard>5000)$fatal(1,"admission stuck %h",addr);end while(!req_ready[0]);
       @(negedge clk);cpu_valid=0;guard=0;
       while(!rsp_valid[0]) begin @(negedge clk);guard=guard+1;if(guard>5000)$fatal(1,"response stuck %h",addr);end
       if(rsp_timeout[0] || rsp_fault_code[31:0]!==expected_fault || (!writing && rsp_rdata[31:0]!==expected))
        $fatal(1,"%h value %h fault %h expected %h/%h",addr,rsp_rdata[31:0],rsp_fault_code[31:0],expected,expected_fault);
      end
    endtask
    task automatic write_reg(input [31:0] a,v);transfer(1,a,v,0,0);endtask
    task automatic read_reg(input [31:0] a,v);transfer(0,a,0,v,0);endtask
    task automatic edge_supervisor;begin @(negedge clk);supervisor_edge=1;@(negedge clk);supervisor_edge=0;end endtask
    task automatic nmi_accept;begin @(negedge clk);cpu_nmi_accepted=1;cpu_user_mode=0;@(negedge clk);cpu_nmi_accepted=0;end endtask
    initial begin #10000000;$fatal(1,"watchdog phase %d target %d local %b dma %b",sys.phase,sys.target,local_boundary_ready,supervisor_boundary_ready);end
    initial begin
      repeat(8) @(negedge clk);power_reset_n=1;reset_n=1;wait(memory_ready);
      // Physical CORE and LOCAL route a multibyte diagnostic character and a
      // flush to the real byte owner; nothing is visible before publication.
      write_reg(32'h08010230,32'h1f600);
      if(debug_byte_valid) $fatal(1,"partial diagnostic line became visible");
      read_reg(32'h08010350,0);
      read_reg(32'h08010230,32'h1f600);write_reg(32'h08010234,0);
      @(negedge clk);if(!debug_byte_valid || debug_byte!==8'hf0)$fatal(1,"diagnostic byte 0");debug_byte_ready=1;
      @(negedge clk);if(!debug_byte_valid || debug_byte!==8'h9f)$fatal(1,"diagnostic byte 1");
      @(negedge clk);if(!debug_byte_valid || debug_byte!==8'h98)$fatal(1,"diagnostic byte 2");
      @(negedge clk);if(!debug_byte_valid || debug_byte!==8'h80)$fatal(1,"diagnostic byte 3");
      @(negedge clk);if(!debug_byte_valid || debug_byte!==8'h0a)$fatal(1,"diagnostic newline");
      @(negedge clk);debug_byte_ready=0;if(debug_byte_valid)$fatal(1,"extra diagnostic byte");
      // TIME_MS uses the installed system clock, independent of beam/IRQ state.
      read_reg(32'h08010228,0);
      // Arrange a real CPU -> CORE -> LOCAL read exactly on the first
      // millisecond carry. The accepted read samples the pre-edge time word.
      while(sys.timebase.fraction!=18'd169330) @(negedge clk);
      read_reg(32'h08010228,0);
      if(!time_carry_sample_seen || sys.timebase.time_ms!==1)
          $fatal(1,"TIME_MS carry-edge sample or updated time incorrect");
      read_reg(32'h08010228,1);
      repeat(40000) @(negedge clk);
      read_reg(32'h08010228,2);
      write_reg(32'h080103e4,32'h08020000);write_reg(32'h080103e8,32'h08030000);
      write_reg(32'h080103ec,1);write_reg(32'h080103f0,11<<2);write_reg(32'h080103f8,1);
      write_reg(32'h08000008,4);@(negedge clk);external_irq_raise=4;@(negedge clk);external_irq_raise=0;
      edge_supervisor();repeat(4) @(negedge clk);
      if(status_word!==1 || !producer_quiesce || cpu_boundary_hold || !trigger_inhibit || !apu_voice_hold)
       $fatal(1,"producer entry sequencing or CPU held too early");
      read_reg(32'h08010350,1);read_reg(32'h08000024,32'h1234abcd);
      geo_quiescent=1;imgdec_quiescent=1;wait(gpu_boundary_quiesce);repeat(3) @(negedge clk);
      if(!cpu_boundary_hold || nmi_request) $fatal(1,"GPU boundary not waited");
      gpu_quiescent=1;wait(nmi_request);nmi_accept();
      // ENTER response precedes bank load, or LOCAL waits on itself.
      fork
       write_reg(32'h0801034c,2);
       begin
        wait(sys.activation_pending);@(negedge clk);supervisor_edge=1;
        @(negedge clk);supervisor_edge=0;
       end
      join
      wait(gpu_enter_count==1);repeat(2) @(negedge clk);
      if(status_word!==5 || enter_count!=1 || leave_count!=0) $fatal(1,"enter status or bank pulse");
      read_reg(32'h08000000,0);read_reg(32'h08000008,0);read_reg(32'h080103f4,0);
      write_reg(32'h0801034c,32'h18);
      read_reg(32'h08010428,1);read_reg(32'h0801042c,32'h11223344);
      read_reg(32'h08010430,32'h55667788);read_reg(32'h08010434,32'h99aabbcc);
      read_reg(32'h08010438,32'hdeadbeef);read_reg(32'h0801043c,1);
      edge_supervisor();read_reg(32'h08010350,7);
      // An eligible DMA block can be admitted on the same edge as the CPU's
      // LEAVE write. It writes FAULT during BUS quiescence. The redirect must
      // not ENTER the already retained cartridge IRQ/DMA banks a second time.
      memory.words[20'h08000]=8;request_lines[13]=0;
      write_reg(32'h0800000c,32'h08020000);write_reg(32'h08000010,32'h0801034c);
      write_reg(32'h08000014,1);write_reg(32'h08000018,13<<2);write_reg(32'h08000020,1);
      fork
       write_reg(32'h0801034c,4);
       begin
        wait(system_valid && system_write && system_address==32'h0801034c && system_wdata==4);
        @(negedge clk);request_lines[13]=1;
       end
      join
      wait(unit.pending[0]);wait(status_word==5 && !cpu_boundary_hold);
      if(enter_count!=1 || gpu_enter_count!=1 || leave_count!=0)
       $fatal(1,"FAULT during LEAVE re-banked retained cartridge context");
      if(unit.user_pending!==4 || unit.user_mask!==4 || unit.dma.context_bank.user_status[63:32]!==1)
       $fatal(1,"FAULT redirect corrupted retained IRQ/DMA user bank");
      write_reg(32'h0801034c,4);wait(leave_count==1);repeat(2) @(negedge clk);
      if(status_word!==0 || gpu_leave_count!=1 || apu_voice_hold) $fatal(1,"leave status/pulses");
      read_reg(32'h08000000,4);read_reg(32'h08000008,4);read_reg(32'h080103f4,1);
      geo_quiescent=0;imgdec_quiescent=0;gpu_quiescent=0;
      write_reg(32'h0801034c,8);if(status_word!==1 || nmi_request)$fatal(1,"fault entry");
      geo_quiescent=1;imgdec_quiescent=1;wait(gpu_boundary_quiesce);gpu_quiescent=1;
      wait(gpu_enter_count==2);if(nmi_request || status_word!==5)$fatal(1,"fault route");
      write_reg(32'h0801034c,4);wait(leave_count==2);repeat(2) @(negedge clk);
      cpu_user_mode=1;gpu_quiescent=0;edge_supervisor();wait(gpu_boundary_quiesce);gpu_quiescent=1;wait(nmi_request);nmi_accept();
      write_reg(32'h0801034c,32'h1e);wait(leave_count==3);repeat(2) @(negedge clk);
      if(enter_count!=3 || gpu_enter_count!=3 || gpu_leave_count!=3 || status_word!==0 || nmi_request)
       $fatal(1,"multi-bit command ordering");
      read_reg(32'h08010428,2);read_reg(32'h0801042c,32'h11223344);
      cpu_user_mode=1;write_reg(32'h0801034c,32'h1f);if(!reset_request || status_word!==0) $fatal(1,"privilege");
      read_reg(32'h08010428,2);@(negedge clk);reset_taken=1;@(negedge clk);reset_taken=0;if(reset_request) $fatal(1,"reset request");
      transfer(1,32'h08010350,1,0,3);transfer(1,32'h0801042c,1,0,3);
      // Real integrated deadlock case: CPU's TRIGGER is blocked while an
      // already-eligible DMA block still needs LOCAL for its destination.
      memory.words[20'h08000]=32'h55aa0123;request_lines[13]=0;
      write_reg(32'h0800000c,32'h08020000);write_reg(32'h08000010,32'h08000008);
      write_reg(32'h08000014,1);write_reg(32'h08000018,(13<<2)|1);write_reg(32'h08000020,1);
      geo_quiescent=0;imgdec_quiescent=0;gpu_quiescent=0;edge_supervisor();
      @(negedge clk);cpu_valid=1;cpu_write=1;cpu_address=32'h080103f8;cpu_wdata=1;cpu_size=4;cpu_access=32'h402;
      do @(posedge clk);while(!req_ready[0]);@(negedge clk);cpu_valid=0;
      wait(local_valid && local_address==32'h080103f8 && !local_ready);
      request_lines[13]=1;wait(block_active);
      geo_quiescent=1;imgdec_quiescent=1;
      wait(cpu_local_withdrawn);if(rsp_valid[0])$fatal(1,"withdraw forged CPU completion");
      wait(gpu_boundary_quiesce);if(!unit.pending[0])$fatal(1,"GPU boundary preceded admitted DMA completion");
      gpu_quiescent=1;wait(nmi_request);nmi_accept();write_reg(32'h0801034c,2);
      wait(gpu_enter_count==4);write_reg(32'h0801034c,4);wait(leave_count==4);repeat(2) @(negedge clk);
      read_reg(32'h08000008,32'h55aa0123);
      // A FAULT during ordinary producer quiescence redirects the existing
      // transition; it neither restarts that boundary nor requests another NMI.
      cpu_user_mode=1;geo_quiescent=0;imgdec_quiescent=0;gpu_quiescent=0;edge_supervisor();
      cpu_user_mode=0;write_reg(32'h0801034c,8);
      if(sys.phase!==1 || sys.target!==2 || nmi_request) $fatal(1,"fault did not redirect producer stage");
      geo_quiescent=1;imgdec_quiescent=1;wait(gpu_boundary_quiesce);gpu_quiescent=1;
      wait(gpu_enter_count==5);if(nmi_request || status_word!==5)$fatal(1,"redirect raised NMI or missed context");
      write_reg(32'h0801034c,4);wait(leave_count==5);repeat(2) @(negedge clk);
      transfer(1,32'h08010228,1,0,3);
      $display("PASS SYSTEM -> actual CORE/LOCAL/DMA/IRQ: exact TIME_MS routing, staged quiescence, command-ack-before-drain, context/fault/combined controls");$finish;
    end
endmodule
