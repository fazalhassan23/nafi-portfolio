'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../public/appointment-calendar');
test('calendar handles leap years and rejects impossible visit dates',()=>{
 assert.equal(calendar.validDate('2024-02-29'),true);assert.equal(calendar.validDate('2025-02-29'),false);assert.equal(calendar.validDate('2026-04-31'),false);assert.equal(calendar.validDate(''),false);
});
test('Monday-first month layout includes padding and every date exactly once',()=>{
 const leap=calendar.cells('2024-02');assert.equal(leap[0].date,'2024-01-29');assert.equal(leap.length,35);assert.equal(leap.filter(cell=>cell.inMonth).length,29);assert.equal(leap.at(-1).date,'2024-03-03');
 const monday=calendar.cells('2021-02');assert.equal(monday.length,28);assert.equal(monday[0].date,'2021-02-01');
 assert.deepEqual(calendar.cells('2026-13'),[]);
});
test('month navigation crosses year boundaries without skipping February',()=>{
 assert.equal(calendar.shiftMonth('2026-12',1),'2027-01');assert.equal(calendar.shiftMonth('2027-01',-1),'2026-12');assert.equal(calendar.shiftMonth('2024-03',-1),'2024-02');
});
test('requests group by preferred visit date, with undated requests separate',()=>{
 const grouped=calendar.group([{id:1,preferred_date:'2026-10-24'},{id:2,preferred_date:''},{id:3,preferred_date:'2026-10-24'},{id:4,preferred_date:'2026-02-30'}]);assert.equal(grouped.dates['2026-10-24'].length,2);assert.deepEqual(grouped.undated.map(row=>row.id),[2,4]);
});
