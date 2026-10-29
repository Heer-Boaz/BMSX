`timescale 1ns/1ps

// Deterministic populated x16 NOR array with explicit access/disable delays.
// This is a pin timing model, not a flash programmer or an erase simulator.
module rom_sys_endpoint_tb;
    localparam real SYS_PERIOD=1000000000.0/33868800.0;
    reg clk=0;
    always #(SYS_PERIOD/2.0) clk=!clk;
    reg reset_n=1, cs_rom_n=0;
    reg req_valid=0,req_write=0;
    wire req_ready,rsp_valid;
    reg [31:0] req_addr=0,req_wdata=0,req_meta=32'hffffffff;
    reg [3:0] req_be_n=0;
    reg [17:0] req_data_wait_last=15;
    wire [31:0] rsp_rdata,rsp_fault_code,master_out,endpoint_out;
    wire rsp_timeout,master_oe,endpoint_oe,ready_low;
    wire bus_as_n,bus_rd_n,bus_wr_n;
    wire [3:0] bus_be_n;
    tri [31:0] bus_ad;
    tri1 bus_ready_n;
    wire [21:0] flash_address;
    wire flash_ce_n,flash_oe_n;
    wire [15:0] flash_data;
    assign bus_ad=master_oe ? master_out : 32'bz;
    assign bus_ad=endpoint_oe ? endpoint_out : 32'bz;
    assign bus_ready_n=ready_low ? 1'b0 : 1'bz;
    system_bus_master master (
        .req_header_be_n(4'hf), .bus_busy(),
        .clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
        .req_write(req_write),.req_addr(req_addr),.req_wdata(req_wdata),.req_be_n(req_be_n),
        .req_meta(req_meta),.req_data_timeout_enable(1'b1),
        .req_data_wait_last(req_data_wait_last),.rsp_valid(rsp_valid),
        .rsp_rdata(rsp_rdata),.rsp_fault_code(rsp_fault_code),.rsp_timeout(rsp_timeout),
        .bus_ad_in(bus_ad),.bus_ad_out(master_out),.bus_ad_oe(master_oe),
        .bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),
        .bus_be_n(bus_be_n),.bus_ready_n(bus_ready_n)
    );
    rom_sys_endpoint dut (
        .clk(clk),.reset_n(reset_n),.cs_rom_n(cs_rom_n),
        .bus_ad_in(bus_ad),.bus_ad_out(endpoint_out),.bus_ad_oe(endpoint_oe),
        .bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),
        .bus_be_n(bus_be_n),.bus_ready_drive_low(ready_low),
        .flash_data(flash_data),.flash_address(flash_address),
        .flash_ce_n(flash_ce_n),.flash_oe_n(flash_oe_n)
    );
    function automatic [15:0] array_word(input [21:0] address);
        // Every physical address bit influences these fixture contents. The
        // first word is a boot-header example; 0x200 is a programmed zero.
        case(address)
            0:array_word=16'h4d42;
            1:array_word=16'h5853;
            22'h000100,22'h000101:array_word=0;
            default:array_word=16'h5a3c ^ address[15:0] ^ {address[21:16],10'h29b};
        endcase
    endfunction
    // 70 ns CE/address access, 20 ns output disable. The endpoint only ever
    // reads, so no second driver is connected to this physical data bus.
    assign #(70,70,20) flash_data = reset_n && !flash_ce_n && !flash_oe_n ?
        array_word(flash_address) : 16'bz;

    realtime reset_release_time=0,read_start=0,last_disable=0;
    realtime minimum_read=1000000,minimum_gap=1000000;
    reg had_disable=0,read_open=0;
    reg [21:0] frozen_address;
    integer read_edges=0,halfword_reads=0,data_edges=0,transfers=0,max_data_edges=0;
    integer last_bus_reads=0;
    reg last_word_half=0;
    reg [21:0] last_word_address=0;
    always @(posedge reset_n) reset_release_time=$realtime;
    always @(negedge flash_ce_n) begin
        #0;
        if(flash_oe_n!==0) $fatal(1,"Flash CE/OE did not enable together");
        if($realtime-reset_release_time<50) $fatal(1,"Read launched before modeled reset recovery");
        if(had_disable) begin
            if($realtime-last_disable<SYS_PERIOD-0.003) $fatal(1,"Flash release shorter than one CLK_IO interval");
            if($realtime-last_disable<minimum_gap) minimum_gap=$realtime-last_disable;
            if(flash_data!==16'bz) $fatal(1,"Next halfword enabled before previous output reached high-Z");
        end
        read_start=$realtime;read_edges=0;frozen_address=flash_address;read_open=1;
        halfword_reads=halfword_reads+1;
        if(last_word_half && flash_address!==last_word_address+1'b1)
            $fatal(1,"High halfword was not the next physical x16 address");
        last_word_address=flash_address;
        last_word_half=!last_word_half;
    end
    always @(posedge flash_ce_n) if(read_open) begin
        if(reset_n && bus_as_n && !bus_rd_n && bus_wr_n) begin
            if(read_edges!=4 || $realtime-read_start<4*SYS_PERIOD-0.003)
                $fatal(1,"Capture did not retain four full address-stable clocks");
            if($realtime-read_start<minimum_read) minimum_read=$realtime-read_start;
            if(flash_data!==array_word(frozen_address)) $fatal(1,"Flash word was captured before 70 ns access");
        end else last_word_half=0; // reset/timeout aborted this word, not a halfword pair
        last_disable=$realtime;had_disable=1;read_open=0;
    end
    always @(posedge clk) begin
        if(read_open && !flash_ce_n) begin
            read_edges=read_edges+1;
            if(flash_address!==frozen_address) $fatal(1,"Flash address changed during access");
        end
        if(reset_n) begin
            if(master_oe && endpoint_oe) $fatal(1,"Native SYS_AD contention");
            if(!bus_ready_n && bus_as_n && bus_rd_n && bus_wr_n) $fatal(1,"READY held during turnaround/release");
            if(bus_as_n && bus_rd_n!=bus_wr_n) data_edges=data_edges+1;
            if(!bus_ready_n && bus_as_n && !bus_rd_n && bus_wr_n && (^bus_ad===1'bx))
                $fatal(1,"Data ACK carried unknown/undriven SYS data");
            if(!req_ready && req_valid && rsp_valid) $fatal(1,"Completion contradicted master admission");
        end
    end
    task automatic tick; @(posedge clk);#1;endtask
    task automatic transfer(input bit writing,input [31:0] address,input [31:0] word,
        input [3:0] be,input [17:0] budget,input [31:0] fault,input bit timeout,input [31:0] expected);
        integer before_reads;
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=writing;req_addr=address;req_wdata=word;req_be_n=be;req_data_wait_last=budget;
        before_reads=halfword_reads;data_edges=0;tick();
        @(negedge clk);req_valid=0;
        req_addr=~address;req_wdata=~word;req_be_n=~be;req_data_wait_last=~budget;
        while(!rsp_valid) begin
            if(req_ready) $fatal(1,"Busy native master accepted another request");
            tick();
        end
        if(rsp_timeout!==timeout || rsp_fault_code!==fault || rsp_rdata!==expected)
            $fatal(1,"Native result addr=%h data=%h/%h fault=%h/%h timeout=%b/%b",address,rsp_rdata,expected,rsp_fault_code,fault,rsp_timeout,timeout);
        if(data_edges>max_data_edges) max_data_edges=data_edges;
        if(!timeout && data_edges>16) $fatal(1,"Read exceeded ordinary 16-DATA-clock budget");
        last_bus_reads=halfword_reads-before_reads;transfers=transfers+1;
        @(negedge clk);#1;
        if(endpoint_oe || ready_low || !flash_ce_n || !flash_oe_n) $fatal(1,"Completed transaction retained output ownership");
    endtask
    task automatic read_word(input [31:0] address);
        reg [21:0] low_address;
        reg [31:0] expected;
        low_address=address[22:1];expected={array_word(low_address+1'b1),array_word(low_address)};
        transfer(0,address,0,0,15,0,0,expected);
        if(last_bus_reads!=2 || data_edges!=12) $fatal(1,"x32 read was not two timed x16 reads/12 DATA clocks");
    endtask
    task automatic reset_during_read(input integer half);
        @(negedge clk);while(!req_ready) @(negedge clk);
        req_valid=1;req_write=0;req_addr=32'h007ffffc;req_wdata=0;req_be_n=0;req_data_wait_last=15;
        tick();@(negedge clk);req_valid=0;
        @(negedge flash_ce_n);
        if(half!=0) begin @(posedge flash_ce_n);@(negedge flash_ce_n);end
        #7;reset_n=0;#1;
        if(!flash_ce_n || !flash_oe_n || endpoint_oe || ready_low || rsp_valid)
            $fatal(1,"Async reset did not release active flash/SYS pins");
        #700;
        // Arbitrary input phase, not a reset deassertion aligned to CLK_IO.
        reset_n=1;
        read_word(32'h00000000);
    endtask
    initial begin
        #2;reset_n=0;
        // Model valid rails plus a complete reset, not an invented power-good.
        #110000;reset_n=1;
        read_word(0);read_word(4);read_word(32'h00200000);read_word(32'h00400000);
        read_word(32'h00600000);read_word(32'h007ffffc);read_word(32'h00000200);
        transfer(0,32'h00800000,0,0,15,0,0,0);if(last_bus_reads!=0)$fatal(1,"Upper window mirrored flash");
        transfer(0,32'h00fffffc,0,0,15,0,0,0);if(last_bus_reads!=0)$fatal(1,"Upper window enabled flash");
        transfer(0,32'h00000001,0,0,15,2,0,0);if(last_bus_reads!=0)$fatal(1,"Unaligned read reached flash");
        transfer(0,0,0,4'b1110,15,2,0,0);if(last_bus_reads!=0)$fatal(1,"Partial read reached flash");
        transfer(0,32'h00800001,0,4'b1111,15,2,0,0);
        transfer(1,0,32'hdeadbeef,0,15,1,0,0);if(last_bus_reads!=0)$fatal(1,"ROM write reached flash");
        transfer(1,32'h00000001,32'hdeadbeef,4'b1110,15,1,0,0);
        transfer(1,32'h00ffffff,32'hdeadbeef,4'b1111,15,1,0,0);
        read_word(0); // rejected stores did not modify the boot prefix
        cs_rom_n=1;transfer(0,0,0,0,15,0,1,0);if(last_bus_reads!=0)$fatal(1,"Deselected flash active");cs_rom_n=0;
        transfer(0,32'h01000000,0,0,15,0,1,0);if(last_bus_reads!=0)$fatal(1,"Address beyond public window selected flash");
        // Initiator withdrawals during each halfword cannot leave a queued ACK.
        transfer(0,0,0,0,2,0,1,0);#150;read_word(4);
        transfer(0,0,0,0,7,0,1,0);#150;read_word(32'h007ffffc);
        reset_during_read(0);reset_during_read(1);
        $display("PASS rom_sys_endpoint transfers=%0d x16_accesses=%0d max_DATA=%0d stable_min_ns=%0.3f release_min_ns=%0.3f",transfers,halfword_reads,max_data_edges,minimum_read,minimum_gap);
        $finish;
    end
    initial begin #2000000;$fatal(1,"NOR endpoint watchdog");end
endmodule
