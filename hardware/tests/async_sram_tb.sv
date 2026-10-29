`timescale 1ns/1ps

module async_sram_case #(
    parameter integer DATA_WIDTH=32,
    parameter integer ADDRESS_WIDTH=19,
    parameter real HALF_NS=9.259259259259
) (output reg done=0);
    localparam integer BYTES=DATA_WIDTH/8;
    reg clk=0;
    always #(HALF_NS) clk=!clk;
    reg power_reset_n=1, reset_n=1, req_valid=0, req_write=0;
    wire req_ready;
    reg [ADDRESS_WIDTH-1:0] req_address=0;
    reg [DATA_WIDTH-1:0] req_wdata=0;
    reg [BYTES-1:0] req_be_n=0;
    wire rsp_valid;
    wire [DATA_WIDTH-1:0] rsp_rdata;
    tri [DATA_WIDTH-1:0] mem_data;
    wire [ADDRESS_WIDTH-1:0] mem_address;
    wire mem_ce_n, mem_oe_n, mem_we_n;
    wire [BYTES-1:0] mem_be_n;
    wire [DATA_WIDTH/16-1:0] chip_drives;
    reg [DATA_WIDTH-1:0] expected [0:(1<<ADDRESS_WIDTH)-1];
    reg [DATA_WIDTH-1:0] expected_response [0:1023];
    integer accepted_cycle [0:1023];
    reg expected_write [0:1023];
    integer accepted=0,responded=0,cycle=0;
    integer period_start, count_start, response_start;
    integer i,lane,s,frame_number;
    reg monitor=0;
    async_sram #(.DATA_WIDTH(DATA_WIDTH),.ADDRESS_WIDTH(ADDRESS_WIDTH)) dut (.*);
    genvar chip;
    generate for(chip=0;chip<DATA_WIDTH/16;chip=chip+1) begin : part
        issi_bll_pin_model #(.ADDRESS_WIDTH(ADDRESS_WIDTH),
            .PATTERN(chip==0 ? 16'h5a5a : 16'ha5a5)) device (
            .address(mem_address),.data(mem_data[chip*16+:16]),
            .ce_n(mem_ce_n),.oe_n(mem_oe_n),.we_n(mem_we_n),
            .be_n(mem_be_n[chip*2+:2]),.drive_active(chip_drives[chip]));
    end endgenerate
    initial begin
        for(integer a=0;a<(1<<ADDRESS_WIDTH);a=a+1)
            for(integer c=0;c<DATA_WIDTH/16;c=c+1)
                expected[a][c*16+:16]=(c==0 ? 16'h5a5a : 16'ha5a5) ^
                    (a & 16'hffff) ^ (a>>16);
    end
    always @(mem_data or chip_drives or dut.data_drive) if(monitor) begin
        if(dut.data_drive && |chip_drives)
            $fatal(1,"Controller/SRAM physical data ownership overlapped");
    end
    always @(posedge clk) begin
        cycle=cycle+1;
        if(reset_n && monitor) begin
            if(req_valid && req_ready) begin
                expected_write[accepted]=req_write;
                accepted_cycle[accepted]=cycle;
                if(req_write) begin
                    for(integer b=0;b<BYTES;b=b+1) if(!req_be_n[b])
                        expected[req_address][b*8+:8]=req_wdata[b*8+:8];
                    expected_response[accepted]=0;
                end else expected_response[accepted]=expected[req_address];
                accepted=accepted+1;
            end
            #0.001;
            if(rsp_valid) begin
                if(responded==accepted) $fatal(1,"SRAM replied without an accepted request");
                if(rsp_rdata!==expected_response[responded])
                    $fatal(1,"SRAM%0d response%0d mismatch: got%h expected%h",DATA_WIDTH,responded,rsp_rdata,expected_response[responded]);
                if(cycle-accepted_cycle[responded]!=(expected_write[responded] ? 2 : 1))
                    $fatal(1,"Native SRAM read/write completion latency changed");
                responded=responded+1;
            end
            if(!mem_oe_n && mem_be_n!={BYTES{1'b0}})
                $fatal(1,"Read masks narrowed the native SRAM word");
        end
    end
    task automatic request(input bit writing,input [ADDRESS_WIDTH-1:0] address,
        input [DATA_WIDTH-1:0] word,input [BYTES-1:0] mask);
        begin
            @(negedge clk);req_valid=1;req_write=writing;
            req_address=address;req_wdata=word;req_be_n=mask;
            @(posedge clk);while(!req_ready) @(posedge clk);
            @(negedge clk);req_valid=0;
        end
    endtask
    task automatic drain;
        begin @(negedge clk);req_valid=0;repeat(5) @(negedge clk);
            if(accepted!=responded) $fatal(1,"SRAM outstanding response was lost");end
    endtask
    initial begin
        #1;power_reset_n=0;reset_n=0;repeat(5) @(negedge clk);power_reset_n=1;reset_n=1;
        repeat(3) @(negedge clk);monitor=1;
        // Actual maximum native-word indices and high address bits, not a
        // reduced address-width model. Each write mask crosses real chip bytes.
        request(0,0,0,{BYTES{1'b1}});
        request(0,{ADDRESS_WIDTH{1'b1}},0,{BYTES{1'b1}});
        request(0,1<<(ADDRESS_WIDTH-1),0,{BYTES{1'b1}});
        for(lane=0;lane<BYTES;lane=lane+1) begin
            request(1,{ADDRESS_WIDTH{1'b1}},32'h12345678 ^ lane,
                {BYTES{1'b1}} ^ (1<<lane));
            request(0,{ADDRESS_WIDTH{1'b1}},0,{BYTES{1'b1}});
        end
        request(1,7,{DATA_WIDTH{1'b1}},{BYTES{1'b1}}); //no lanes enabled
        request(0,7,0,{BYTES{1'b1}});
        drain();
        // Hold a direction-changing request while busy: it cannot drive pins
        // early or overwrite the current transfer. In-flight fields are owned.
        request(1,8,32'hf00dcafe,0);
        request(0,8,0,{BYTES{1'b1}});
        request(1,9,32'h89abcdef,0);
        drain();
        // Pin schedule:48 read issues, one full R->W guard, seven2-slot writes,
        // one full W->R guard. Repeat periods to include the wrap boundary.
        count_start=accepted;response_start=responded;
        for(frame_number=0;frame_number<3;frame_number=frame_number+1) begin
            @(negedge clk);period_start=cycle+1;
            for(s=0;s<64;s=s+1) begin
                req_valid=s<48 || (s>=49 && s<=61 && s[0]);
                req_write=s>=49;
                req_address=128+frame_number*64+s;
                req_wdata=32'h87654321 ^ (frame_number*64+s);
                req_be_n=0;
                @(posedge clk);
                if(req_valid && !req_ready)
                    $fatal(1,"SRAM%0d cannot sustain64-slot schedule atslot%0d",DATA_WIDTH,s);
                #0.002;
                if(s==48 || s==63) begin
                    if(!mem_ce_n || !mem_oe_n || !mem_we_n || dut.data_drive)
                        $fatal(1,"SRAM direction guard was not an entire high-Z slot");
                end
                if(s==63 && cycle-period_start!=63)
                    $fatal(1,"SRAM schedule acquired hidden slots");
                if(s!=63) @(negedge clk);
            end
        end
        drain();
        if(accepted-count_start!=3*55 || responded-response_start!=3*55)
            $fatal(1,"SRAM schedule dropped read/write requests");
        // Warm reset blocks admission/responses, not a write waveform that the
        // SRAM has already accepted. Even before WE falls, finish that write.
        request(0,10,0,0);drain();
        @(negedge clk);req_valid=1;req_write=1;req_address=10;req_wdata=0;req_be_n=0;
        @(posedge clk);#0.002;monitor=0;reset_n=0;req_valid=0;
        #0.002;
        if(mem_ce_n || !dut.data_drive || rsp_valid || req_ready)
            $fatal(1,"Warm reset truncated accepted write or admitted a request");
        accepted=0;responded=0;
        repeat(5) @(negedge clk);
        if(!mem_ce_n || !mem_oe_n || !mem_we_n || dut.data_drive || rsp_valid)
            $fatal(1,"Completed warm-reset write did not park pins");
        reset_n=1;repeat(3) @(negedge clk);
        monitor=1;request(0,10,0,0);request(0,9,0,0);drain();
        // Reset1ns after WE falls must not shorten its>=8ns pulse. Neither DATA
        // nor address may vanish at reset; the half-slot hold must still run.
        @(negedge clk);req_valid=1;req_write=1;req_address=11;
        req_wdata=32'hc0decafe;req_be_n=0;
        @(posedge clk);@(negedge mem_we_n);#1;
        monitor=0;reset_n=0;req_valid=0;accepted=0;responded=0;
        #1;
        if(mem_we_n || mem_ce_n || !dut.data_drive || req_ready || rsp_valid)
            $fatal(1,"Warm reset1ns after WE assertion interrupted physical write");
        @(posedge mem_we_n);#1;
        if(!dut.data_drive || mem_address!=11 || mem_data!==req_wdata)
            $fatal(1,"Warm reset removed address/data before write hold ended");
        repeat(5) @(negedge clk);reset_n=1;repeat(3) @(negedge clk);
        monitor=1;request(0,11,0,0);drain();
        // The same hold rule applies when reset arrives1ns after WE rises.
        @(negedge clk);req_valid=1;req_write=1;req_address=12;
        req_wdata=32'h1234f00d;req_be_n=0;
        @(posedge clk);@(negedge mem_we_n);req_valid=0;
        @(posedge mem_we_n);#1;
        monitor=0;reset_n=0;accepted=0;responded=0;
        #1;
        if(!dut.data_drive || mem_address!=12 || mem_data!==req_wdata || rsp_valid)
            $fatal(1,"Warm reset1ns after WE release shortened data/address hold");
        repeat(5) @(negedge clk);reset_n=1;repeat(3) @(negedge clk);
        monitor=1;request(0,12,0,0);drain();
        // A pending read may park only at its normal capture edge, and cannot
        // replay its old response after the warm-reset admission synchronizer.
        @(negedge clk);req_valid=1;req_write=0;req_address=13;
        @(posedge clk);#1;monitor=0;reset_n=0;req_valid=0;
        accepted=0;responded=0;
        #1;
        if(mem_ce_n || mem_oe_n || req_ready || rsp_valid)
            $fatal(1,"Warm reset prematurely ended the active read slot");
        @(posedge clk);#0.002;
        if(!mem_ce_n || !mem_oe_n || rsp_valid)
            $fatal(1,"Warm reset failed to park at normal read-slot end");
        repeat(5) @(negedge clk);reset_n=1;repeat(3) @(negedge clk);
        monitor=1;request(0,13,0,0);drain();
        $display("PASS: SRAM%0d/%0d halfclock%0.6fns, native inout timing/masks/guards/reset/no-rollback and3x64slots=144reads+21writes",DATA_WIDTH,ADDRESS_WIDTH,HALF_NS);
        done=1;
    end
endmodule

module async_sram_tb;
    wire gfx_done,apu_done;
    async_sram_case gfx (.done(gfx_done));
    async_sram_case #(.DATA_WIDTH(16),.ADDRESS_WIDTH(18),
        .HALF_NS(14.762849584278)) apu (.done(apu_done));
    initial begin wait(gfx_done && apu_done);$finish;end
    initial begin #100000;$fatal(1,"SRAM test timeout");end
endmodule
