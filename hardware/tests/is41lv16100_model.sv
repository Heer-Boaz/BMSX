`timescale 1ns/1ps
// Pin model of the native U10/U11 pair: IS41LV16100-50KI, non-B Rev. L
// 12/22/2005. One 32-bit array represents the two parallel x16 devices, not
// on-ASIC memory. CAS0/1 own U10 bytes; CAS2/3 own U11 bytes. Physical OE is
// SOJ42 pin29, shared with U1.49 MOE_N; pin15 really is NC.
//
// The exposed words array is for test pre-seeding/inspection only. Neither POR
// nor any other reset erases it. A true power loss exempts interrupted-cycle
// timing checks; there is no content-retention guarantee across power loss.
module is41lv16100_pair_model (
    input wire clk, power_reset_n,
    input wire [9:0] ma,
    inout wire [31:0] md,
    input wire ras_n,
    input wire [3:0] cas_n,
    input wire we_n,oe_n
);
    reg [31:0] words[0:1048575];
    integer refreshes=0,reads=0,writes=0;
    reg [9:0] row_address,refresh_row=0;
    reg refresh_cycle=0;
    reg [3:0] column_seen=0, retained_read=0;
    reg [31:0] read_data=0;
    realtime power_time=0,ras_fall=0,ras_rise=0,ma_change=0,we_fall=0;
    realtime cas_fall[0:3],cas_rise[0:3],write_fall[0:3],row_refreshed[0:1023];
    realtime last_cbr=0,max_refresh_gap=0;
    reg [3:0] written_lane=0;
    reg [31:0] written_data=0;
    // Access waits for all of RAS50ns, column25ns and CAS13ns. EDO may retain
    // the previous read output while CAS is low even when RAS is high; model
    // that conservatively so sharing CAS/OE cannot hide bank contention.
    // Use the 15ns OE-disable bound for all disable causes (CAS/RAS alone:12ns).
    genvar lane;
    generate for(lane=0;lane<4;lane=lane+1) begin: data_outputs
        assign #(0,0,15) md[lane*8 +:8]=power_reset_n && we_n && !oe_n &&
            ((!ras_n && !refresh_cycle && (!cas_n[lane] || retained_read[lane])) ||
             (ras_n && !cas_n[lane] && retained_read[lane])) ? read_data[lane*8 +:8] : 8'bz;
    end endgenerate

    always @(negedge power_reset_n) begin
        refreshes=0;reads=0;writes=0;refresh_row=0;
        refresh_cycle=0;column_seen=0;written_lane=0;retained_read=0;
        power_time=0;ras_fall=0;ras_rise=0;last_cbr=0;max_refresh_gap=0;
        for(integer r=0;r<1024;r=r+1) row_refreshed[r]=0;
        for(integer b=0;b<4;b=b+1) begin cas_fall[b]=0;cas_rise[b]=0;write_fall[b]=0;end
    end
    always @(posedge power_reset_n) power_time=$realtime;
    always @(ma) begin
        if(power_reset_n && !ras_n && !refresh_cycle && $realtime-ras_fall<8)
            $fatal(1,"DRAM row-address hold violated");
        for(integer b=0;b<4;b=b+1)
            if(power_reset_n && !ras_n && !refresh_cycle && column_seen[b] && $realtime-cas_fall[b]<8)
                $fatal(1,"DRAM column address hold after CAS falling shorter than8ns");
        ma_change=$realtime;
    end
    always @(negedge we_n) we_fall=$realtime;
    always @(negedge ras_n) if(power_reset_n) begin
        if($realtime-power_time<200000) $fatal(1,"DRAM activity before 200us power-up wait");
        if(ras_rise!=0 && $realtime-ras_rise<30) $fatal(1,"DRAM RAS precharge shorter than30ns");
        ras_fall=$realtime;column_seen=0;written_lane=0;
        refresh_cycle=cas_n==0;
        if(refresh_cycle) begin
            if(!we_n || !oe_n) $fatal(1,"CBR refresh drove write/output control");
            for(integer b=0;b<4;b=b+1)
                if($realtime-cas_fall[b]<5) $fatal(1,"CBR CAS setup shorter than5ns");
            if(row_refreshed[refresh_row]!=0 && $realtime-row_refreshed[refresh_row]>16000000)
                $fatal(1,"DRAM row missed16ms retention bound");
            row_refreshed[refresh_row]=$realtime;refresh_row=refresh_row+1'b1;
            refreshes=refreshes+1;
            if(refreshes>8 && last_cbr!=0 && $realtime-last_cbr>max_refresh_gap)
                max_refresh_gap=$realtime-last_cbr;
            last_cbr=$realtime;
        end else begin
            if(cas_n!==4'hf || refreshes<8) $fatal(1,"Normal DRAM cycle before8CBR initialization cycles");
            row_address=ma;row_refreshed[ma]=$realtime;
        end
    end
    always @(posedge ras_n) if(power_reset_n && ras_fall!=0) begin
        if($realtime-ras_fall<50) $fatal(1,"DRAM RAS pulse shorter than50ns");
        if(!refresh_cycle)
            for(integer b=0;b<4;b=b+1) if(column_seen[b] && $realtime-cas_rise[b]<37)
                $fatal(1,"DRAM CAS-precharge-to-RAS hold shorter than37ns");
        ras_rise=$realtime;
    end
    task automatic column_fall(input integer b);
        integer address;
        realtime wait_time;
        begin
            cas_fall[b]=$realtime;
            if(power_reset_n && !ras_n && !refresh_cycle) begin
                if($realtime-ras_fall<12) $fatal(1,"DRAM RAS-to-CAS shorter than12ns");
                address={row_address,ma};column_seen[b]=1;
                if(!we_n) begin
                    if((^md[b*8 +:8])===1'bx) $fatal(1,"DRAM write data undriven/contended");
                    words[address][b*8 +:8]=md[b*8 +:8];
                    written_data[b*8 +:8]=md[b*8 +:8];written_lane[b]=1;
                    write_fall[b]=$realtime;
                    writes=writes+1;
                end else begin
                    // tRAD/tRCD maxima are reference conditions only. At this
                    // later column, tAA and tCAC govern the data-access bound.
                    wait_time=13;
                    if(50-($realtime-ras_fall)>wait_time) wait_time=50-($realtime-ras_fall);
                    if(25-($realtime-ma_change)>wait_time) wait_time=25-($realtime-ma_change);
                    retained_read[b]=1;
                    read_data[b*8 +:8]=8'bx;
                    read_data[b*8 +:8]<=#(wait_time) words[address][b*8 +:8];
                    reads=reads+1;
                end
            end
        end
    endtask
    task automatic column_rise(input integer b);
        begin
            if(power_reset_n && !ras_n && !refresh_cycle && column_seen[b]) begin
                if($realtime-cas_fall[b]<8) $fatal(1,"DRAM CAS pulse shorter than8ns");
            end
            if(power_reset_n && refresh_cycle && $realtime-ras_rise<8)
                $fatal(1,"CBR CAS hold shorter than8ns");
            cas_rise[b]=$realtime;
        end
    endtask
    always @(negedge cas_n[0]) column_fall(0);
    always @(negedge cas_n[1]) column_fall(1);
    always @(negedge cas_n[2]) column_fall(2);
    always @(negedge cas_n[3]) column_fall(3);
    always @(posedge cas_n[0]) column_rise(0);
    always @(posedge cas_n[1]) column_rise(1);
    always @(posedge cas_n[2]) column_rise(2);
    always @(posedge cas_n[3]) column_rise(3);
    always @(md) if(power_reset_n)
        for(integer b=0;b<4;b=b+1) if(written_lane[b] &&
            $realtime-write_fall[b]<8 && md[b*8 +:8]!==written_data[b*8 +:8])
            $fatal(1,"DRAM write data hold shorter than8ns");
    always @(posedge clk) if(power_reset_n && refreshes>1032 && last_cbr!=0 &&
        $realtime-last_cbr>16000000) $fatal(1,"DRAM refresh engine stopped beyond retention");
endmodule
