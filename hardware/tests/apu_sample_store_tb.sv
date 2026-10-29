`timescale 1ns/1ps
module apu_sample_store_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    reg clk=0;
    always #(PERIOD/2.0) clk=~clk;
    reg reset_n=1, power_reset_n=1;
    reg req_valid=0, req_write=0;
    reg [16:0] req_word_address=0;
    reg [31:0] req_wdata=0;
    reg [3:0] req_be_n=0;
    wire req_ready, rsp_valid, memory_ready;
    wire [31:0] rsp_rdata;
    wire [17:0] mem_address;
    tri [15:0] mem_data;
    wire mem_ce_n, mem_oe_n, mem_we_n;
    wire [1:0] mem_be_n;
    wire chip_drives;
    integer cycle=0, accepted=0, responded=0;
    integer accepted_cycle[0:127];
    reg [31:0] expected_response[0:127];
    integer max_latency=0, max_interval=0, previous_accept=0;
    integer clear_writes=0, clear_start, clear_cycles, first_clear_cycles;
    reg checking=0, sweep=0;
    reg [31:0] expected_word;
    reg [16:0] probe_address;

    apu_sample_store dut (.*);
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'ha53c)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );
    always @(posedge clk) begin
        cycle=cycle+1;
        if (checking && reset_n && power_reset_n) begin
            if (req_ready && !memory_ready) $fatal(1,"APU admitted a word before reset clear");
            if (req_valid && req_ready) begin
                accepted_cycle[accepted]=cycle;
                if (previous_accept!=0 && cycle-previous_accept>max_interval)
                    max_interval=cycle-previous_accept;
                previous_accept=cycle;accepted=accepted+1;
            end
            #0.001;
            if (rsp_valid) begin
                if (responded==accepted) $fatal(1,"APU response without accepted word");
                if (rsp_rdata!==expected_response[responded])
                    $fatal(1,"APU word%0d got%h expected%h",responded,rsp_rdata,expected_response[responded]);
                if (cycle-accepted_cycle[responded]>32) $fatal(1,"APU word exceeded32 SYS clocks");
                if (cycle-accepted_cycle[responded]>max_latency) max_latency=cycle-accepted_cycle[responded];
                responded=responded+1;
            end
        end
    end
    always @(mem_data or chip_drives or dut.pins.data_drive) if(checking)
        if(dut.pins.data_drive && chip_drives) $fatal(1,"APU SRAM data drivers overlap");
    always @(posedge mem_we_n) if(sweep && reset_n && power_reset_n && !mem_ce_n) begin
        if(mem_address!==clear_writes[17:0] || mem_data!==16'd0 || mem_be_n!==0)
            $fatal(1,"APU clear missed/reordered a physical halfword: %h expected%h",mem_address,clear_writes);
        clear_writes=clear_writes+1;
    end

    task automatic clear_complete;
        begin
            wait(memory_ready);#1;
            clear_cycles=cycle-clear_start;
            if(clear_writes!=262144) $fatal(1,"APU clear wrote%0d halfwords",clear_writes);
            for(integer address=0;address<262144;address=address+1)
                if(device.words[address]!==0) $fatal(1,"APU clear left data at halfword%h",address);
            sweep=0;
            $display("APU physical reset clear cycles=%0d time_ms=%0.6f last_halfword=%h",clear_cycles,
                clear_cycles*1000.0/33868800.0,mem_address);
        end
    endtask
    task automatic offer(input bit writing,input [16:0] address,input [31:0] word,
                         input [3:0] mask,input [31:0] expected);
        begin
            @(negedge clk);req_valid=1;req_write=writing;req_word_address=address;
            req_wdata=word;req_be_n=mask;
            while(!req_ready) @(negedge clk);
            expected_response[accepted]=expected;
            @(posedge clk);#1;
        end
    endtask
    task automatic drain;
        begin
            req_valid=0;
            wait(responded==accepted);@(negedge clk);
        end
    endtask
    task automatic warm_clear;
        begin
            reset_n=0;req_valid=0;checking=0;
            #1;if(memory_ready || req_ready || rsp_valid) $fatal(1,"APU reset did not withdraw admission/response");
            repeat(5) @(negedge clk);
            accepted=0;responded=0;previous_accept=0;clear_writes=0;
            clear_start=cycle;sweep=1;checking=1;reset_n=1;
            clear_complete();
            if(clear_cycles!=first_clear_cycles) $fatal(1,"Warm clear changed physical sweep cost");
        end
    endtask

    initial begin
        #2;power_reset_n=0;reset_n=0;
        #100;clear_start=cycle;clear_writes=0;sweep=1;checking=1;
        req_valid=1;req_word_address=17'h1ffff;expected_response[0]=0;
        power_reset_n=1;reset_n=1;
        clear_complete();first_clear_cycles=clear_cycles;
        @(posedge clk);#1;drain();
        if(accepted!=1 || responded!=1) $fatal(1,"Held reset-time request was not admitted exactly once after clear");
        offer(1,0,32'h89abcdef,0,0);offer(0,0,0,4'hf,32'h89abcdef);
        offer(1,17'h1ffff,32'h76543210,0,0);
        offer(0,17'h1ffff,0,0,32'h76543210);
        offer(0,0,0,0,32'h89abcdef);
        for(integer mask=0;mask<16;mask=mask+1) begin
            probe_address=(mask<<13) ^ 17'h01235;
            offer(1,probe_address,32'h10203040,0,0);
            expected_word=32'h10203040;
            for(integer byte_lane=0;byte_lane<4;byte_lane=byte_lane+1)
                if(!mask[byte_lane]) expected_word[byte_lane*8+:8]=32'hfedcba98>>(byte_lane*8);
            offer(1,probe_address,32'hfedcba98,mask[3:0],0);
            offer(0,probe_address,0,4'hf,expected_word);
        end
        drain();
        if(max_interval>32) $fatal(1,"Back-to-back APU words exceeded32clock service interval");
        // Warm reset while a real write pulse is low: the pin controller must
        // finish that pulse, but this word owner must suppress its old response.
        offer(1,17'h1ffff,32'hdeadbeef,0,0);req_valid=0;
        wait(!mem_we_n);#1;warm_clear();
        offer(0,0,0,0,0);offer(0,17'h1ffff,0,0,0);drain();
        // Reset during a read also restarts the full physical clear.
        offer(0,17'h1ffff,0,0,0);req_valid=0;
        wait(!mem_oe_n);#1;warm_clear();
        offer(0,17'h1ffff,0,0,0);offer(0,0,0,0,0);drain();
        $display("PASS apu_sample_store max_latency=%0d max_back_to_back_interval=%0d reset_clear_cycles=%0d",
            max_latency,max_interval,first_clear_cycles);
        $finish;
    end
    initial begin #100000000;$fatal(1,"APU sample store watchdog");end
endmodule
