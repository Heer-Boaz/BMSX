`timescale 1ns/1ps
// Reference physical endpoint connected to the real console CAD arbiter,
// U51 transceiver timing, 70 ns x16 ROM and the ISSI asynchronous SRAM model.
module cart_reference_card_tb;
    reg clk=0; always #14.76285 clk=!clk;
    reg power_reset_n=0,reset_n=0,valid=0,writing=0,cancel=0,timed=0;
    reg [31:0] address=0,value=0;
    reg [7:0] bus_signals=8'h04;
    reg [2:0] width=4;
    reg [17:0] wait_last=0;
    wire [1:0] req_ready,rsp_valid,rsp_timeout,cs_n,ready_n;
    wire [63:0] rsp_data,fault;
    wire cal_lo,cal_hi,cart_clk,rd_n,wr_n,dir,oe_n;
    wire [1:0] be_n;
    tri [15:0] cad_core,cad_card,ram_data,rom_data;
    wire drive_to_card,drive_to_core,irq_n,dreq_r,dreq_w;
    wire [3:0] ram_address,rom_address;
    wire ram_ce_n,ram_oe_n,ram_we_n,rom_ce_n,rom_oe_n;
    wire [1:0] ram_be_n;
    wire part_drive;
    wire empty_irq_n,empty_dreq_r,empty_dreq_w,empty_rom_ce_n,empty_rom_oe_n;
    wire empty_ram_ce_n,empty_ram_oe_n,empty_ram_we_n;
    wire [1:0] empty_ram_be_n;
    wire [3:0] empty_rom_address,empty_ram_address;
    tri [15:0] empty_rom_data,empty_ram_data;
    wire [7:0] rom_low=8'h10+{rom_address,1'b0};
    wire [7:0] rom_high=8'h11+{rom_address,1'b0};
    assign #(70,70,20) rom_data=!rom_ce_n && !rom_oe_n ? {rom_high,rom_low} : 16'bz;
    cart_rom_arbiter bridge (
        .clk(clk),.reset_n(reset_n),.req_valid({1'b0,valid}),.req_cancel({1'b0,cancel}),
        .req_ready(req_ready),.req_address({32'b0,address}),.req_write({1'b0,writing}),
        .req_size_bytes({3'd4,width}),.req_wdata({32'b0,value}),.req_bus_signals({8'b0,bus_signals}),
        .selected_socket(1'b0),.req_data_timeout_enable({1'b0,timed}),
        .req_data_wait_last({18'b0,wait_last}),.rsp_valid(rsp_valid),.rsp_data(rsp_data),
        .rsp_fault_code(fault),.rsp_timeout(rsp_timeout),.cad(cad_core),
        .cart_ready_n(ready_n),.cart_present_n(2'b00),.cal_lo(cal_lo),.cal_hi(cal_hi),
        .cart_clk(cart_clk),.crd_n(rd_n),.cwr_n(wr_n),.cbe_n(be_n),.cs_cart_n(cs_n),
        .cart_dir(dir),.cart_oe_n(oe_n)
    );
    cart_bus_buffer_model u51 (.reset_n(reset_n),.oe_n(oe_n),.dir(dir),
        .cad_core(cad_core),.cad_card(cad_card),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));
    cart_reference_card #(.ROM_ADDRESS_WIDTH(4),.ROM_BYTES(13),.RAM_ADDRESS_WIDTH(4),.RAM_BYTES(13)) card (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.cs_n(cs_n[0]),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.rd_n(rd_n),.wr_n(wr_n),.be_n(be_n),.cad(cad_card),
        .ready_n(ready_n[0]),.irq_n(irq_n),.dreq_read(dreq_r),.dreq_write(dreq_w),
        .rom_data(rom_data),.rom_address(rom_address),.rom_ce_n(rom_ce_n),.rom_oe_n(rom_oe_n),
        .ram_data(ram_data),.ram_address(ram_address),.ram_ce_n(ram_ce_n),.ram_oe_n(ram_oe_n),
        .ram_we_n(ram_we_n),.ram_be_n(ram_be_n)
    );
    issi_bll_pin_model #(.ADDRESS_WIDTH(4)) ram (
        .address(ram_address),.data(ram_data),.ce_n(ram_ce_n),.oe_n(ram_oe_n),
        .we_n(ram_we_n),.be_n(ram_be_n),.drive_active(part_drive)
    );
    cart_reference_card #(.ROM_ADDRESS_WIDTH(4),.ROM_BYTES(0),.RAM_ADDRESS_WIDTH(4),.RAM_BYTES(0),.MAILBOX_PRESENT(0)) empty_card (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.cs_n(cs_n[1]),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.rd_n(rd_n),.wr_n(wr_n),.be_n(be_n),.cad(cad_card),
        .ready_n(ready_n[1]),.irq_n(empty_irq_n),.dreq_read(empty_dreq_r),.dreq_write(empty_dreq_w),
        .rom_data(empty_rom_data),.rom_address(empty_rom_address),.rom_ce_n(empty_rom_ce_n),.rom_oe_n(empty_rom_oe_n),
        .ram_data(empty_ram_data),.ram_address(empty_ram_address),.ram_ce_n(empty_ram_ce_n),
        .ram_oe_n(empty_ram_oe_n),.ram_we_n(empty_ram_we_n),.ram_be_n(empty_ram_be_n)
    );
    realtime last_cad_change=0;
    integer cases=0,pulses=0,withdrawal_at_ready=0;
    always @(cad_card) last_cad_change=$realtime;
    always @(negedge ready_n[0]) if(!rd_n && $realtime-last_cad_change<20)
        $fatal(1,"card read READY before 20 ns data setup");
    always @(negedge ram_we_n) if(power_reset_n) pulses=pulses+1;
    always @(posedge clk) if(drive_to_card && drive_to_core) $fatal(1,"U51 contention");
    always @(posedge clk)
        if(card.phase==3 && !card.request_strobe && card.ram_ready && !cs_n[0])
            withdrawal_at_ready=withdrawal_at_ready+1;
    task automatic start(input bit w,input [2:0] n,input [31:0] a,input [31:0] d,input bit t,input [17:0] last);
        integer guard;
        begin
            @(negedge clk);writing=w;width=n;address=a;value=d;timed=t;wait_last=last;valid=1;guard=0;
            do begin @(posedge clk);guard=guard+1;if(guard>100)$fatal(1,"admission timeout");end while(!req_ready[0]);
            @(negedge clk);valid=0;
        end
    endtask
    task automatic finish(input [31:0] expected,input bit timeout_expected);
        integer guard;
        begin
            guard=0;
            do begin @(posedge clk);guard=guard+1;if(guard>500)$fatal(1,"response timeout");end while(!rsp_valid[0]);
            if(rsp_timeout[0]!==timeout_expected || fault[31:0]!==0 || (!timeout_expected && rsp_data[31:0]!==expected))
                $fatal(1,"addr=%h width=%d write=%b got %h/%b expected %h/%b",address,width,writing,rsp_data[31:0],rsp_timeout[0],expected,timeout_expected);
            cases=cases+1;@(negedge clk);
        end
    endtask
    task automatic access(input bit w,input [2:0] n,input [31:0] a,input [31:0] d,input [31:0] expected);
        begin start(w,n,a,d,0,0);finish(expected,0);end
    endtask
    integer p;
    initial begin
        repeat(4) @(posedge clk);@(negedge clk);power_reset_n=1;
        // A diagnostic timeout withdraws CWR while startup clear is still
        // draining. The owner becomes ready in that same release interval.
        // It must not accept the withdrawn write, even though CS is still low.
        @(negedge clk);reset_n=1;repeat(19) @(posedge clk);
        start(1,1,32'h30000000,32'hbb,1,0);finish(0,1);
        if(withdrawal_at_ready!=1) $fatal(1,"withdrawal/owner-ready race not exercised");
        wait(card.ram_init);repeat(5) @(posedge clk);
        access(0,1,32'h30000000,0,0);
        access(0,4,32'h10000000,0,32'h13121110); // legacy ROM profile
        access(0,4,32'h10000001,0,32'h14131211); // odd extended ROM
        access(0,4,32'h1000000b,0,32'h00001c1b); // partial ROM tail
        access(1,4,32'h30000001,32'h11223344,0);
        access(0,4,32'h30000001,0,32'h11223344);
        access(0,2,32'h30000003,0,32'h1122);
        p=pulses;access(1,4,32'h3000000b,32'hffffffff,0);
        if(pulses!=p) $fatal(1,"partial RAM tail wrote physical SRAM");
        access(1,4,32'h30f00000,32'h89abcdef,0);
        access(0,4,32'h30f00001,0,32'h89abcdef);
        access(0,2,32'h30f00001,0,32'hcdef);
        access(0,1,32'h30f00001,0,32'hcd);
        access(1,4,32'h30f00004,32'h80000007,0);
        if(irq_n!==0 || dreq_r!==1 || dreq_w!==1) $fatal(1,"mailbox outputs");
        access(1,4,32'h30f0000c,1,0);
        if(irq_n!==1) $fatal(1,"mailbox acknowledgment");
        // Cancel with physical ROM output enabled, then immediately read a
        // different value. Exercise both the scalar and legacy interfaces.
        start(0,4,32'h10000001,0,0,0);wait(!rom_oe_n);#1;cancel=1;
        repeat(2) @(posedge clk);@(negedge clk);cancel=0;
        access(0,4,32'h10000005,0,32'h18171615);
        start(0,4,32'h10000000,0,0,0);wait(!rom_oe_n);#1;cancel=1;
        repeat(2) @(posedge clk);@(negedge clk);cancel=0;
        access(0,4,32'h10000004,0,32'h17161514);
        // Neither an incomplete nor an unsupported mailbox write may commit.
        access(1,4,32'h30f00000,32'h01020304,0);
        start(1,4,32'h30f00000,32'hfacebeef,0,0);
        wait(card.phase==7 && card.half==0);#1;cancel=1;
        repeat(2) @(posedge clk);@(negedge clk);cancel=0;
        access(0,4,32'h30f00000,0,32'h01020304);
        access(1,1,32'h30f00000,32'h99,0);
        access(1,2,32'h30f00000,32'h9999,0);
        access(1,4,32'h30f00001,32'h99999999,0);
        access(0,4,32'h30f00000,0,32'h01020304);
        access(1,4,32'h30f00004,7,0);
        access(1,4,32'h30f0000c,0,0);
        if(irq_n!==0) $fatal(1,"zero ACK cleared IRQ");
        access(1,4,32'h30f0000c,1,0);
        if(irq_n!==1 || dreq_r!==1 || dreq_w!==1) $fatal(1,"ACK modified control");
        // Timeout during ROM must not leak its stale response to the next read.
        start(0,4,32'h10000001,0,1,0);finish(0,1);repeat(2) @(posedge clk);
        access(0,4,32'h10000001,0,32'h14131211);
        // Abort an active SRAM read, then issue a write while it drains.
        start(0,4,32'h30000001,0,0,0);wait(!ram_oe_n);#1;cancel=1;
        repeat(2) @(posedge clk);@(negedge clk);cancel=0;
        access(1,4,32'h30000001,32'h55667788,0);
        access(0,4,32'h30000001,0,32'h55667788);
        // Abort an accepted SRAM write; the next read must see its full commit.
        start(1,4,32'h30000001,32'h12345678,0,0);wait(!ram_we_n);#1;cancel=1;
        repeat(2) @(posedge clk);@(negedge clk);cancel=0;
        access(0,4,32'h30000001,0,32'h12345678);
        // Reset after the last CAD write portion: drain all physical pulses.
        p=pulses;start(1,4,32'h30000003,32'haabbccdd,0,0);
        wait(!ram_we_n);#1;reset_n=0;repeat(3) @(posedge clk);@(negedge clk);reset_n=1;
        wait(!card.ram_busy);repeat(5) @(posedge clk);
        if(pulses-p!=3) $fatal(1,"accepted RAM write did not drain");
        access(0,4,32'h30000003,0,32'haabbccdd);
        access(0,4,32'h30f00000,0,0); // mailbox reset, RAM retained
        bus_signals=8'h0c;
        access(0,4,32'h10000001,0,0);access(0,4,32'h30000001,0,0);
        access(1,4,32'h30000001,32'h11223344,0);
        access(1,4,32'h30f00004,32'h00000007,0);
        access(0,4,32'h30f00004,0,0);
        if(!empty_rom_ce_n || !empty_rom_oe_n || !empty_ram_ce_n || !empty_ram_oe_n ||
           !empty_ram_we_n || !empty_irq_n || empty_dreq_r || empty_dreq_w)
            $fatal(1,"empty card drove nonexistent storage or mailbox outputs");
        bus_signals=8'h04;
        access(0,4,32'h30000003,0,32'haabbccdd);
        $display("PASS physical reference card: %0d ROM/RAM/mailbox/timeout/reset operations",cases);
        $finish;
    end
endmodule
