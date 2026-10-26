(function(){
  var STATUSES=['new','confirmed','completed','cancelled'];
  var calendar=AppointmentCalendar;
  var today=calendar.today();
  var state={status:'',q:'',counts:{},view:'calendar',month:today.slice(0,7),selected:today,undated:false,days:[],undatedCount:0};
  var loadSequence=0;
  var $=function(id){return document.getElementById(id)};
  function api(path,opts){
    opts=opts||{};opts.credentials='same-origin';
    if(opts.body&&typeof opts.body!=='string'){opts.body=JSON.stringify(opts.body);opts.headers={'Content-Type':'application/json'}}
    return fetch(path,opts).then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok){var e=new Error(d.error||'Error');e.status=r.status;throw e}return d})});
  }
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
  function show(loggedIn){$('login').hidden=loggedIn;$('app').hidden=!loggedIn;if(loggedIn)load();else{loadSequence++;$('list').textContent='';$('calendar-days').textContent='';$('pw').focus()}}

  $('go').onclick=function(){
    $('lerr').textContent='';
    api('/api/admin/login',{method:'POST',body:{password:$('pw').value}}).then(function(){$('pw').value='';show(true)}).catch(function(e){$('lerr').textContent=e.message});
  };
  $('pw').onkeydown=function(e){if(e.key==='Enter')$('go').click()};
  $('out').onclick=function(){api('/api/admin/logout',{method:'POST'}).then(function(){show(false)})};
  $('csv').onclick=function(){location.href='/api/admin/export.csv?'+qs()};
  var t;$('q').oninput=function(){clearTimeout(t);t=setTimeout(function(){state.q=$('q').value;load()},250)};
  function qs(summary){var p=new URLSearchParams();if(state.status)p.set('status',state.status);if(state.q)p.set('q',state.q);if(summary)p.set('month',state.month);else if(state.undated)p.set('undated','1');else if(state.view==='calendar')p.set('date',state.selected);return p.toString()}
  function chooseView(view){state.view=view;state.undated=false;load()}
  $('view-calendar').onclick=function(){chooseView('calendar')};
  $('view-list').onclick=function(){chooseView('list')};
  $('undated').onclick=function(){state.undated=!state.undated;load()};
  function chooseMonth(month){if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))return;state.month=month;state.selected=month===today.slice(0,7)?today:month+'-01';state.undated=false;load()}
  $('previous-month').onclick=function(){chooseMonth(calendar.shiftMonth(state.month,-1))};
  $('next-month').onclick=function(){chooseMonth(calendar.shiftMonth(state.month,1))};
  $('month-picker').onchange=function(){chooseMonth(this.value)};
  $('calendar-today').onclick=function(){today=calendar.today();state.selected=today;state.month=today.slice(0,7);state.undated=false;load()};
  function renderCalendar(){
    $('calendar-view').hidden=state.view!=='calendar';
    $('view-calendar').setAttribute('aria-pressed',String(state.view==='calendar'));
    $('view-list').setAttribute('aria-pressed',String(state.view==='list'));
    $('undated').setAttribute('aria-pressed',String(state.undated));
    $('undated').textContent='Without a date'+(state.view==='calendar'?' ('+state.undatedCount+')':'');
    $('calendar-month').textContent=calendar.formatMonth(state.month);$('month-picker').value=state.month;
    $('previous-month').disabled=state.month==='1900-01';$('next-month').disabled=state.month==='2199-12';
    var grouped={};state.days.forEach(function(day){if(!grouped[day.date])grouped[day.date]={total:0,statuses:{}};grouped[day.date].total+=day.count;grouped[day.date].statuses[day.status]=day.count});
    var body=$('calendar-days');body.textContent='';var row;
    calendar.cells(state.month).forEach(function(cell,index){
      if(index%7===0){row=el('tr');body.appendChild(row)}
      var td=el('td');row.appendChild(td);
      if(!cell.inMonth){td.appendChild(el('div','calendar-outside',String(cell.day)));return}
      var info=grouped[cell.date]||{total:0,statuses:{}},button=el('button','calendar-day'+(cell.date===today?' today':'')+(!state.undated&&state.selected===cell.date?' selected':''));
      var label=calendar.formatDate(cell.date)+', '+info.total+' request'+(info.total===1?'':'s');
      var statusText=STATUSES.filter(function(status){return info.statuses[status]}).map(function(status){return status+': '+info.statuses[status]}).join(', ');
      button.setAttribute('aria-label',label+(statusText?', '+statusText:''));button.setAttribute('aria-pressed',String(!state.undated&&state.selected===cell.date));if(cell.date===today)button.setAttribute('aria-current','date');
      var number=el('span','calendar-day-number');number.appendChild(el('span',null,String(cell.day)));if(info.total)number.appendChild(el('span','calendar-count',String(info.total)));button.appendChild(number);
      if(info.total){var dots=el('span','calendar-dots');dots.setAttribute('aria-hidden','true');STATUSES.forEach(function(status){if(info.statuses[status]){var dot=el('i','calendar-dot '+status);dot.title=status+': '+info.statuses[status];dots.appendChild(dot)}});button.appendChild(dots)}
      button.onclick=function(){state.selected=cell.date;state.undated=false;load()};td.appendChild(button);
    });
    $('detail-title').textContent=state.undated?'Requests without a preferred date':state.view==='calendar'?calendar.formatDate(state.selected):'All appointment requests';
    $('detail-note').textContent=state.undated?'Contact these patients to arrange a suitable visit date.':state.view==='calendar'?'Manage the requests for this preferred date below.':'Showing requests across all dates. Status and search filters apply.';
  }

  function renderTabs(){
    var box=$('tabs');box.textContent='';
    [''].concat(STATUSES).forEach(function(s){
      var n=s===''?STATUSES.reduce(function(a,k){return a+(state.counts[k]||0)},0):(state.counts[s]||0);
      var b=el('button',null,(s||'all')+' ('+n+')');b.style.textTransform='capitalize';
      b.setAttribute('aria-pressed',String(state.status===s));
      b.onclick=function(){state.status=s;load()};box.appendChild(b);
    });
  }
  function fmt(iso){var d=new Date(iso);return isNaN(d)?iso:d.toLocaleString('en-GB', {timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'})+' (Dhaka)'}
  function render(rows){
    var list=$('list');list.textContent='';
    if(!rows.length){list.appendChild(el('div','empty','No requests match this date or filter.'));return}
    rows.forEach(function(r){
      var c=el('article','item');
      var top=el('div','top');top.appendChild(el('b',null,r.name));
      var right=el('span');right.appendChild(el('span','pill '+r.status,r.status));top.appendChild(right);c.appendChild(top);
      var meta=el('div','meta');
      var a=el('a',null,r.phone);a.href='tel:'+r.phone;meta.appendChild(a);
      var cleanDigits = r.phone.replace(/[^\d]/g, '');
      if (cleanDigits) {
        var wa=el('a',null,'WhatsApp');
        wa.href='https://wa.me/'+(cleanDigits.length===11&&cleanDigits.startsWith('01')?'88'+cleanDigits:cleanDigits);
        wa.target='_blank';wa.rel='noopener noreferrer';wa.style.color='#128c7e';wa.style.fontWeight='600';
        meta.appendChild(wa);
      }
      if(r.lang)meta.appendChild(el('span',null,r.lang==='bn'?'[বাংলা]':'[EN]'));
      if(r.area)meta.appendChild(el('span',null,r.area));
      if(r.preferred_date)meta.appendChild(el('span',null,'Preferred: '+r.preferred_date));
      meta.appendChild(el('span','ref',r.ref+' · '+fmt(r.created_at)));
      c.appendChild(meta);
      if(r.message)c.appendChild(el('div','msg',r.message));
      var act=el('div','act');
      var sel=el('select');sel.setAttribute('aria-label','Status');
      STATUSES.forEach(function(s){var o=el('option',null,s);o.value=s;o.style.textTransform='capitalize';if(s===r.status)o.selected=true;sel.appendChild(o)});
      var note=el('textarea');note.placeholder='Private note';note.value=r.note||'';note.setAttribute('aria-label','Private note');
      var save=el('button','primary','Save');
      save.onclick=function(){save.disabled=true;api('/api/admin/appointments/'+r.id,{method:'PATCH',body:{status:sel.value,note:note.value}}).then(load).catch(fail).then(function(){save.disabled=false})};
      var del=el('button','danger','Delete');
      del.onclick=function(){if(del.dataset.sure){api('/api/admin/appointments/'+r.id,{method:'DELETE'}).then(load).catch(fail)}else{del.dataset.sure='1';del.textContent='Confirm delete';setTimeout(function(){delete del.dataset.sure;del.textContent='Delete'},3000)}};
      act.appendChild(sel);act.appendChild(note);act.appendChild(save);act.appendChild(del);c.appendChild(act);
      list.appendChild(c);
    });
  }
  function fail(e){if(e.status===401)show(false);else $('load-status').textContent=e.message}
  function load(){
    var sequence=++loadSequence;
    renderCalendar();$('list').textContent='';$('load-status').textContent='Loading appointment requests…';$('list').setAttribute('aria-busy','true');$('limit-warning').hidden=true;
    var tasks=[api('/api/admin/appointments?'+qs())];
    if(state.view==='calendar')tasks.push(api('/api/admin/calendar?'+qs(true)));
    Promise.all(tasks).then(function(results){
      if(sequence!==loadSequence)return;
      var data=results[0];state.counts=data.counts;
      if(results[1]){state.days=results[1].days;state.undatedCount=results[1].undatedCount;}
      renderTabs();renderCalendar();render(data.rows);
      var total=data.matchingCount==null?data.rows.length:data.matchingCount;
      $('load-status').textContent=total+' matching request'+(total===1?'':'s')+(state.status?' · '+state.status:'');
      if(total>data.rows.length){$('limit-warning').hidden=false;$('limit-warning').textContent='Showing the newest '+data.rows.length+' of '+total+' matching requests. Narrow your search to find older records. Calendar counts include all matching requests.';}
    }).catch(function(error){if(sequence===loadSequence)fail(error)}).finally(function(){if(sequence===loadSequence)$('list').setAttribute('aria-busy','false')});
  }
  api('/api/admin/me').then(function(){show(true)}).catch(function(){show(false)});
})();
