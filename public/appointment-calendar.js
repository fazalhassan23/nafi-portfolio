'use strict';
// Shared calendar date helpers; use UTC arithmetic to avoid browser timezone shifts.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AppointmentCalendar=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;var date=new Date(value+'T00:00:00Z');return !isNaN(date)&&date.toISOString().slice(0,10)===value;}
  function dhakaToday(){var parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());var values={};parts.forEach(function(part){values[part.type]=part.value;});return values.year+'-'+values.month+'-'+values.day;}
  function shiftMonth(month,offset){var date=new Date(month+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+offset);return date.toISOString().slice(0,7);}
  function cells(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];var first=new Date(month+'-01T00:00:00Z'),last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);var leading=(first.getUTCDay()+6)%7,total=Math.ceil((leading+last.getUTCDate())/7)*7,result=[];for(var i=0;i<total;i++){var day=new Date(first);day.setUTCDate(i-leading+1);var key=day.toISOString().slice(0,10);result.push({date:key,day:day.getUTCDate(),inMonth:key.slice(0,7)===month});}return result;}
  function group(rows){var dates={},undated=[];rows.forEach(function(row){if(validDate(row.preferred_date)){(dates[row.preferred_date]||(dates[row.preferred_date]=[])).push(row);}else undated.push(row);});return {dates:dates,undated:undated};}
  function formatDate(date){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T00:00:00Z'));}
  function formatMonth(month){return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'long',year:'numeric'}).format(new Date(month+'-01T00:00:00Z'));}
  return {validDate:validDate,today:dhakaToday,shiftMonth:shiftMonth,cells:cells,group:group,formatDate:formatDate,formatMonth:formatMonth};
});
