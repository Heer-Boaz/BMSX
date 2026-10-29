`timescale 1ns/1ps
// The actual CORE fabric and shared CAD arbiter connected to socket-level card
// peers. CPU/DMA/GEO execution units are request producers not implemented here.
module cart_core_ram_integration_tb;
    reg clk=0;
    always #14.763 clk=!clk;
    reg reset_n=1, power_reset_n=1;
    reg [2:0] req_valid=0, req_write=0, req_hold=0;
    wire [2:0] req_ready, rsp_valid, rsp_timeout;
    reg [95:0] req_address=0, req_wdata=0, req_access=0;
    reg [8:0] req_size_bytes={3{3'd4}};
    reg [23:0] req_bus_signals=0;
    reg [2:0] req_data_timeout_enable=0;
    reg [11:0] req_be_n=0;
    reg [53:0] req_data_wait_last=0;
    wire [95:0] rsp_rdata, rsp_fault_code;
    wire memory_ready, block_locked, sys_bus_busy, sys_bus_request;
    wire sys_bus_owned=0;
    tri [31:0] sys_ad, md;
    wire sys_ready_n=1;
    tri sys_as_n, sys_rd_n, sys_wr_n;
    tri [3:0] sys_be_n;
    wire cs_rom_n, cs_io_n, cs_gpu_n, cs_pcrtc_n, cs_apu_n;
    wire [9:0] ma;
    wire mras_n, mwe_n, moe_n;
    wire [3:0] mcas_n;
    wire local_valid, cart_valid, local_write, cart_write;
    wire local_ready=1;
    wire cart_ready;
    wire [31:0] local_address, local_wdata, local_access, cart_address, cart_wdata, cart_access;
    wire [3:0] local_be_n, cart_be_n;
    wire [7:0] local_bus_signals, cart_bus_signals;
    wire [2:0] cart_size_bytes;
    wire cart_data_timeout_enable, cart_rsp_timeout;
    wire [17:0] cart_data_wait_last;
    wire local_rsp_valid=0;
    wire cart_rsp_valid;
    wire [31:0] local_rdata=0, local_fault_code=0;
    wire [31:0] cart_rdata, cart_fault_code;
    wire cpu_local_withdrawn;
    wire cpu_local_withdraw=1'b0;
    core_memory_system core(.geo_raw_memory(1'b1),.cpu_private(1'b0),.mras_private_n(),.moe_private_n(),.*);
    is41lv16100_pair_model memory (.clk(clk),.power_reset_n(power_reset_n),.ma(ma),.md(md),
        .ras_n(mras_n),.cas_n(mcas_n),.we_n(mwe_n),.oe_n(moe_n));

    tri [15:0] cad, card_cad;
    wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n, cart_dir, cart_oe_n;
    wire [1:0] cbe_n, cs_cart_n, cart_ready_n;
    wire drive_to_card, drive_to_core;
    reg [1:0] cart_present_n=2'b10;
    reg selected_socket=0;
    wire [1:0] cad_req_ready, cad_rsp_valid, cad_rsp_timeout;
    wire [63:0] cad_rsp_data, cad_rsp_fault;
    reg peer_valid=0;
    reg [31:0] peer_address=32'h10000000;
    assign cart_ready=cad_req_ready[0];
    assign cart_rsp_valid=cad_rsp_valid[0];
    assign cart_rdata=cad_rsp_data[31:0];
    assign cart_fault_code=cad_rsp_fault[31:0];
    assign cart_rsp_timeout=cad_rsp_timeout[0];
    cart_rom_arbiter bridge (
        .clk(clk),.reset_n(reset_n && power_reset_n),.req_valid({peer_valid,cart_valid}),
        .req_cancel(2'b00),.req_ready(cad_req_ready),.req_address({peer_address,cart_address}),
        .req_write({1'b0,cart_write}),.req_size_bytes({3'd4,cart_size_bytes}),
        .req_wdata({32'd0,cart_wdata}),.req_bus_signals({8'h0c,cart_bus_signals}),
        .selected_socket(selected_socket),.req_data_timeout_enable({1'b0,cart_data_timeout_enable}),
        .req_data_wait_last({18'd0,cart_data_wait_last}),.rsp_valid(cad_rsp_valid),
        .rsp_data(cad_rsp_data),.rsp_fault_code(cad_rsp_fault),.rsp_timeout(cad_rsp_timeout),
        .cad(cad),.cart_ready_n(cart_ready_n),.cart_present_n(cart_present_n),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.cart_clk(cart_clk),.crd_n(crd_n),.cwr_n(cwr_n),
        .cbe_n(cbe_n),.cs_cart_n(cs_cart_n),.cart_dir(cart_dir),.cart_oe_n(cart_oe_n));
    cart_bus_buffer_model buffers (.reset_n(reset_n),.oe_n(cart_oe_n),.dir(cart_dir),
        .cad_core(cad),.cad_card(card_cad),.drive_to_card(drive_to_card),.drive_to_core(drive_to_core));

    tri [15:0] ram_data;
    wire [3:0] ram_address;
    wire ram_ce_n, ram_oe_n, ram_we_n, part_drive, card_ready_n, card_init, card_busy;
    wire [1:0] ram_be_n;
    reg stall_ready=0;
    assign cart_ready_n[0]=card_ready_n | stall_ready;
    assign cart_ready_n[1]=1'b1;
    cart_ram_physical_peer #(.ADDRESS_WIDTH(4),.CAPACITY_BYTES(13)) card (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),.cs_n(cs_cart_n[0]),
        .cal_lo(cal_lo),.cal_hi(cal_hi),.rd_n(crd_n),.wr_n(cwr_n),.be_n(cbe_n),
        .cad(card_cad),.ready_n(card_ready_n),.init_done(card_init),.busy(card_busy),
        .mem_data(ram_data),.mem_address(ram_address),.mem_ce_n(ram_ce_n),
        .mem_oe_n(ram_oe_n),.mem_we_n(ram_we_n),.mem_be_n(ram_be_n));
    issi_bll_pin_model #(.ADDRESS_WIDTH(4)) ram (
        .address(ram_address),.data(ram_data),.ce_n(ram_ce_n),.oe_n(ram_oe_n),
        .we_n(ram_we_n),.be_n(ram_be_n),.drive_active(part_drive));
    integer pulses=0, selects=0, responses=0;
    always @(negedge ram_we_n) if(power_reset_n) pulses=pulses+1;
    always @(negedge cs_cart_n[0]) selects=selects+1;
    always @(posedge clk) if(reset_n) begin
        if(drive_to_card && drive_to_core) $fatal(1,"CAD buffer contention");
        if(|rsp_valid) responses=responses+1;
    end
    task automatic start(input integer client,input [2:0] size,input [31:0] address,value,
                         input bit timed,input [17:0] last);
        integer cycles;
        begin
            @(negedge clk);req_valid[client]=1;req_write[client]=1;
            req_address[client*32 +:32]=address;req_wdata[client*32 +:32]=value;
            req_access[client*32 +:32]=32'h402;req_size_bytes[client*3 +:3]=size;
            req_bus_signals[client*8 +:8]=client==1 ? 8'h05 : 8'h04;
            req_be_n[client*4 +:4]=0;req_data_timeout_enable[client]=timed;
            req_data_wait_last[client*18 +:18]=last;cycles=0;
            do begin @(posedge clk);cycles=cycles+1;if(cycles>300) $fatal(1,"CORE admission timeout");end while(!req_ready[client]);
            @(negedge clk);req_valid[client]=0;
            req_address[client*32 +:32]=32'hffffffff;req_wdata[client*32 +:32]=32'hffffffff;
            req_size_bytes[client*3 +:3]=0;req_bus_signals[client*8 +:8]=0;
            req_data_timeout_enable[client]=0;req_data_wait_last[client*18 +:18]=0;
        end
    endtask
    task automatic finish(input integer client,input [31:0] fault,input bit timeout);
        integer cycles;
        begin
            cycles=0;do begin @(negedge clk);cycles=cycles+1;
                if(cycles>1000) $fatal(1,"CORE response timeout");
            end while(!rsp_valid[client]);
            if(rsp_valid!==(3'b001 << client) || rsp_fault_code[client*32 +:32]!==fault ||
               rsp_timeout[client]!==timeout) $fatal(1,"incorrect CORE result");
        end
    endtask
    integer p,s,r;
    initial begin
        #2;reset_n=0;power_reset_n=0;repeat(20) @(negedge clk);power_reset_n=1;reset_n=1;
        wait(memory_ready && card_init);repeat(4) @(negedge clk);
        p=pulses;start(0,4,32'h30000001,32'h11223344,0,0);finish(0,0,0);
        if(pulses-p!=3 || ram.words[0][15:8]!==8'h44 || ram.words[1]!==16'h2233 ||
           ram.words[2][7:0]!==8'h11) $fatal(1,"CORE odd write did not reach real SRAM");
        p=pulses;start(1,2,32'h30000004,32'h000055aa,0,0);finish(1,0,0);
        if(pulses-p!=1 || ram.words[2]!==16'h55aa) $fatal(1,"DMA halfword path");
        p=pulses;start(0,4,32'h3000000b,32'hdeadbeef,0,0);finish(0,0,0);
        if(pulses!=p) $fatal(1,"partial card tail generated an SRAM write");
        p=pulses;s=selects;start(1,4,32'h30fffffd,32'hdeadbeef,0,0);finish(1,1,0);
        if(pulses!=p || selects!=s) $fatal(1,"aperture fault drove card pins");
        p=pulses;
        fork
            begin start(0,4,32'h30000007,32'haabbccdd,1,20);finish(0,0,1);end
            begin wait(card_busy);@(negedge clk);stall_ready=1;end
        join
        stall_ready=0;wait(!card_busy);repeat(8) @(negedge clk);
        if(pulses-p!=3 || ram.words[3][15:8]!==8'hdd || ram.words[4]!==16'hbbcc ||
           ram.words[5][7:0]!==8'haa) $fatal(1,"timed out commit was lost or repeated");
        p=pulses;r=responses;start(0,4,32'h30000003,32'h12345678,0,0);
        wait(!ram_we_n);#1;reset_n=0;repeat(2) @(posedge clk);@(negedge clk);reset_n=1;
        wait(!card_busy);repeat(8) @(negedge clk);
        if(pulses-p!=3 || responses!=r || ram.words[1][15:8]!==8'h78 ||
           ram.words[2]!==16'h3456 || ram.words[3][7:0]!==8'h12)
            $fatal(1,"CORE reset interrupted an accepted SRAM write");
        wait(memory_ready);repeat(3) @(negedge clk);
        p=pulses;start(0,1,32'h30000000,32'h0000005a,0,0);finish(0,0,0);
        if(pulses-p!=1 || ram.words[0][7:0]!==8'h5a) $fatal(1,"CORE post-reset operation");
        $display("PASS CORE to physical cartridge SRAM: CPU/DMA, odd write, tail, aperture, timeout and reset drain");
        $finish;
    end
endmodule
