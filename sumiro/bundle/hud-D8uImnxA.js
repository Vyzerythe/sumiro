var e=`hud`,t=92,n=!0,r=.6,i=`#1b1712`,a=`#e7dcc1`,o=640,s=360,c=5,l={samurai:`Samurai`},u=`
#ink-ui { position: fixed; inset: 0; pointer-events: none; user-select: none; overflow: hidden; color: ${i}; font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, 'URW Palladio L', Georgia, serif; font-style: italic; --u: min(1vh, 1.78vw); z-index: 5; }
#ink-ui * { box-sizing: border-box; }
#ink-ui .veil { position: absolute; inset: 0; background: #b1a080; transition: opacity 1.6s ease; }
#ink-ui canvas.wash { position: absolute; inset: 0; width: 100%; height: 100%; display: none; }
#ink-ui .card { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: ${a}; opacity: 0; transition: opacity 0.7s ease; }
#ink-ui .card.on { opacity: 1; }
#ink-ui .card .num { font-size: calc(var(--u) * 2.5); letter-spacing: 0.18em; opacity: 0.72; }
#ink-ui .card .name { font-size: calc(var(--u) * 10); line-height: 1.15; margin-top: calc(var(--u) * 1.2); filter: url(#ink-brush-pale); }
#ink-ui .card .sub { font-size: calc(var(--u) * 2.7); margin-top: calc(var(--u) * 1.6); opacity: 0.8; }
#ink-ui .card .tally { font-size: calc(var(--u) * 2.1); margin-top: calc(var(--u) * 1.8); opacity: 0.55; min-height: 1.3em; }
#ink-ui .closing { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; padding: 0 14%; color: ${a}; font-size: calc(var(--u) * 3.6); line-height: 1.4; opacity: 0; transition: opacity 0.9s ease; }
#ink-ui .closing.on { opacity: 1; }
#ink-ui .card .seal { width: calc(var(--u) * 3.4); height: calc(var(--u) * 3.4); margin: calc(var(--u) * 2.4) auto 0; }
#ink-ui .seal { background: #a8321f; border-radius: 12%; filter: url(#ink-edge); display: block; position: relative; }
#ink-ui .seal::after { content: ''; position: absolute; inset: 20%; border: calc(var(--u) * 0.26) solid #e8d9bd; border-radius: 8%; }
#ink-ui .seal::before { content: ''; position: absolute; left: 20%; right: 20%; top: 50%; height: calc(var(--u) * 0.26); margin-top: calc(var(--u) * -0.13); background: #e8d9bd; }
#ink-ui .vitals { position: absolute; left: calc(var(--u) * 3.4); top: calc(var(--u) * 3); opacity: 0; transition: opacity 0.9s ease; filter: drop-shadow(0 0 calc(var(--u) * 0.5) rgba(226, 214, 184, 0.8)); }
#ink-ui .vitals.on { opacity: 1; }
#ink-ui .strokes { display: flex; gap: calc(var(--u) * 0.7); align-items: center; }
#ink-ui .strokes img { height: calc(var(--u) * 2); width: auto; display: block; transition: opacity 0.4s ease, transform 0.4s ease; }
#ink-ui .strokes img.lost { opacity: 0.16; transform: scaleX(0.82); }
#ink-ui .lower { display: flex; align-items: center; gap: calc(var(--u) * 1.5); margin-top: calc(var(--u) * 1); }
#ink-ui .gourds { display: flex; gap: calc(var(--u) * 0.45); }
#ink-ui .gourds img { height: calc(var(--u) * 3.5); width: auto; display: block; transition: opacity 0.4s ease; }
#ink-ui .gourds img.empty { opacity: 0.2; filter: grayscale(1); }
#ink-ui .ink { width: calc(var(--u) * 2); height: calc(var(--u) * 2); display: none; }
#ink-ui .ink.on { display: block; }
#ink-ui .ink circle { fill: none; stroke: ${i}; stroke-width: 15; stroke-linecap: round; transform: rotate(-80deg); transform-origin: 50% 50%; }
#ink-ui .ink.full circle { stroke: #a8321f; }
#ink-ui .catbar { display: none; align-items: center; gap: calc(var(--u) * 0.8); margin-top: calc(var(--u) * 0.9); }
#ink-ui .catbar.on { display: flex; }
#ink-ui .catbar svg { width: calc(var(--u) * 2.7); height: calc(var(--u) * 2.7); filter: url(#ink-edge); flex: none; }
#ink-ui .catbar .fur { position: relative; width: calc(var(--u) * 15); height: calc(var(--u) * 1.5); }
#ink-ui .catbar .fur img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; transition: clip-path 0.45s ease; }
#ink-ui .catbar .fur img.back { opacity: 0.16; }
#ink-ui .catbar .fur i { position: absolute; top: -18%; bottom: -18%; width: calc(var(--u) * 0.22); margin-left: calc(var(--u) * -0.11); background: #a8321f; opacity: 0.75; }
#ink-ui .catbar.low svg .face { fill: #e9b3a6; }
#ink-ui .catbar.low svg, #ink-ui .catbar.low .fur img.front { animation: ink-cat-pulse 0.9s ease-in-out infinite; }
@keyframes ink-cat-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(1.06); } }
#ink-ui .line { position: absolute; left: 0; right: 0; text-align: center; font-size: calc(var(--u) * 2.8); line-height: 1.3; opacity: 0; transition: opacity 0.5s ease; }
#ink-ui .line span { display: inline-block; padding: calc(var(--u) * 1) calc(var(--u) * 6.5); background: radial-gradient(closest-side, rgba(229, 218, 191, 0.95), rgba(229, 218, 191, 0.9) 72%, rgba(229, 218, 191, 0)); text-shadow: 0 0 calc(var(--u) * 0.3) rgba(236, 226, 202, 0.95); }
#ink-ui .line b { font-style: normal; font-weight: 600; font-size: 0.86em; letter-spacing: 0.05em; color: #7c2415; margin: 0 0.12em; }
#ink-ui .line.on { opacity: 1; }
#ink-ui .hint { bottom: calc(var(--u) * 10); }
#ink-ui .prompt { bottom: calc(var(--u) * 4.4); }
#ink-ui.boss .hint { bottom: calc(var(--u) * 16.5); }
#ink-ui.boss .prompt { bottom: calc(var(--u) * 12); }
#ink-ui .note { position: absolute; right: calc(var(--u) * 5); top: 26%; width: calc(var(--u) * 42); font-size: calc(var(--u) * 2.8); line-height: 1.55; text-align: right; opacity: 0; transition: opacity 1.2s ease; text-shadow: 0 0 calc(var(--u) * 0.7) rgba(232, 220, 192, 0.95), 0 0 calc(var(--u) * 1.8) rgba(232, 220, 192, 0.9); }
#ink-ui .note.on { opacity: 1; }
#ink-ui .note small { display: block; margin-top: calc(var(--u) * 1.5); font-size: calc(var(--u) * 2.1); color: #7c2415; }
#ink-ui .menu { position: absolute; inset: 0; opacity: 0; transition: opacity 0.7s ease; pointer-events: none; }
#ink-ui .menu.on { opacity: 1; pointer-events: auto; }
#ink-ui .menu .body { position: absolute; left: 7.5%; top: 11%; width: min(46%, calc(var(--u) * 80)); }
#ink-ui .menu.dim { background: radial-gradient(ellipse at 28% 45%, rgba(203, 188, 155, 0.94) 0%, rgba(190, 173, 138, 0.9) 45%, rgba(160, 142, 108, 0.82) 100%); }
#ink-ui .menu.page .body { top: 8%; width: min(62%, calc(var(--u) * 92)); }
#ink-ui .menu h1 { margin: 0; font-weight: 400; font-size: calc(var(--u) * 11.5); line-height: 1; letter-spacing: -0.012em; filter: url(#ink-brush); }
#ink-ui .menu.pause h1, #ink-ui .menu.page h1 { font-size: calc(var(--u) * 6.4); }
#ink-ui .menu .head { display: flex; align-items: flex-start; gap: calc(var(--u) * 1.6); }
#ink-ui .menu .head .seal { width: calc(var(--u) * 2.6); height: calc(var(--u) * 2.6); margin-top: calc(var(--u) * 2); flex: none; }
#ink-ui .menu .sub { font-size: calc(var(--u) * 2.5); margin-top: calc(var(--u) * 2.4); max-width: 34em; }
#ink-ui .menu ul { list-style: none; margin: calc(var(--u) * 2.8) 0 0; padding: 0; }
#ink-ui .menu.page ul { margin-top: calc(var(--u) * 2.6); }
#ink-ui .menu li { position: relative; font-size: calc(var(--u) * 3.3); line-height: 1.2; padding: calc(var(--u) * 0.75) 0 calc(var(--u) * 0.75) calc(var(--u) * 3.6); opacity: 0.66; cursor: pointer; transition: opacity 0.16s ease; }
#ink-ui .menu.page li { font-size: calc(var(--u) * 2.7); padding-top: calc(var(--u) * 0.55); padding-bottom: calc(var(--u) * 0.55); }
#ink-ui .menu li.sel { opacity: 1; }
#ink-ui .menu.title li { opacity: 0.82; text-shadow: 0 0 calc(var(--u) * 0.5) rgba(226, 214, 186, 0.95), 0 0 calc(var(--u) * 1.4) rgba(226, 214, 186, 0.8); }
#ink-ui .menu.title li.sel { opacity: 1; }
#ink-ui .menu.title .sub { text-shadow: 0 0 calc(var(--u) * 0.6) rgba(226, 214, 186, 0.9); }
#ink-ui .menu li::before { content: ''; position: absolute; left: 0; top: 50%; width: calc(var(--u) * 2.5); height: calc(var(--u) * 1); margin-top: calc(var(--u) * -0.5); background: var(--stroke) center / 100% 100% no-repeat; opacity: 0; transform: scaleX(0.4); transform-origin: right; transition: opacity 0.16s ease, transform 0.2s ease; }
#ink-ui .menu li.sel::before { opacity: 1; transform: none; }
#ink-ui .menu li.row { display: flex; justify-content: space-between; align-items: center; gap: calc(var(--u) * 2); }
#ink-ui .menu li .bar { flex: none; width: calc(var(--u) * 24); height: calc(var(--u) * 2.2); position: relative; }
#ink-ui .menu li .bar i { position: absolute; left: 0; top: 50%; height: calc(var(--u) * 0.14); width: 100%; background: rgba(27, 23, 18, 0.35); }
#ink-ui .menu li .bar b { position: absolute; left: 0; top: 16%; bottom: 16%; background: var(--stroke) left center / 100% 100% no-repeat; }
#ink-ui .menu li .val { flex: none; min-width: calc(var(--u) * 6); text-align: right; }
#ink-ui .menu .poem { font-size: calc(var(--u) * 2.6); line-height: 1.45; margin: 0 0 calc(var(--u) * 2.2); cursor: default; opacity: 1; padding-left: 0; }
#ink-ui .menu .poem::before { display: none; }
#ink-ui .menu .poem b { font-style: normal; font-weight: 600; font-size: 0.86em; letter-spacing: 0.05em; color: #7c2415; }
#ink-ui .menu.page.wide .body { width: min(88%, calc(var(--u) * 150)); }
#ink-ui .menu .poems.cols { column-count: 3; column-gap: calc(var(--u) * 3); }
#ink-ui .menu .poems.cols .poem { font-size: calc(var(--u) * 2.05); line-height: 1.38; margin-bottom: calc(var(--u) * 1.6); break-inside: avoid; }
#ink-ui .credits { position: absolute; inset: 0; overflow: hidden; text-align: center; color: ${a}; opacity: 0; transition: opacity 1.4s ease; font-size: calc(var(--u) * 2.6); line-height: 1.7; }
#ink-ui .credits .roll { position: absolute; left: 0; right: 0; top: 100%; }
#ink-ui .credits h2 { margin: calc(var(--u) * 6) 0 calc(var(--u) * 1.2); font-weight: 400; font-size: calc(var(--u) * 2.1); letter-spacing: 0.16em; opacity: 0.6; }
#ink-ui .credits .ch i { opacity: 0.55; margin-right: 0.6em; }
#ink-ui .credits .ch small { opacity: 0.55; margin-left: 0.6em; font-size: 0.8em; }
#ink-ui .credits .end { position: absolute; inset: 0; display: grid; place-content: center; opacity: 0; transition: opacity 1.4s ease; }
#ink-ui .credits .end.on { opacity: 1; }
#ink-ui .credits.on { opacity: 1; }
#ink-ui .credits .name { font-size: calc(var(--u) * 7); line-height: 1.2; margin-bottom: calc(var(--u) * 2.5); filter: url(#ink-brush-pale); }
#ink-ui .credits .soft { opacity: 0.6; font-size: calc(var(--u) * 2.1); margin-top: calc(var(--u) * 4); }
#ink-ui .subtitle { position: absolute; left: 0; right: 0; bottom: calc(var(--u) * 1.3); display: flex; align-items: center; justify-content: center; text-align: center; opacity: 0; transition: opacity 0.45s ease; }
#ink-ui.speaking .prompt { bottom: calc(var(--u) * 10); }
#ink-ui.speaking .hint { bottom: calc(var(--u) * 15.5); }
#ink-ui.speaking.boss .prompt { bottom: calc(var(--u) * 12); }
#ink-ui.speaking.boss .hint { bottom: calc(var(--u) * 16.5); }
#ink-ui .subtitle.on { opacity: 1; }
#ink-ui .subtitle.bar { bottom: 0; height: calc(var(--u) * 9.5); }
#ink-ui .subtitle span { position: relative; isolation: isolate; display: inline-block; max-width: min(88%, calc(var(--u) * 150)); padding: calc(var(--u) * 1.15) calc(var(--u) * 5.2); color: ${a}; font-size: calc(var(--u) * 3.5); line-height: 1.3; text-shadow: 0 0 calc(var(--u) * 0.35) rgba(17, 15, 12, 0.95); }
#ink-ui .subtitle span::before { content: ''; position: absolute; inset: 0 calc(var(--u) * -1.2); z-index: -1; background: rgba(17, 15, 12, 0.86); -webkit-mask: var(--band) center / 100% 100% no-repeat; mask: var(--band) center / 100% 100% no-repeat; filter: url(#ink-edge); }
#ink-ui .subtitle.bar span { max-width: min(66%, calc(var(--u) * 118)); }
#ink-ui .subtitle.bar span::before { background: rgba(17, 15, 12, 0.6); }
#ink-ui .subtitle small { font-style: normal; font-size: 0.62em; letter-spacing: 0.2em; text-transform: uppercase; color: #d4775c; margin-right: 0.85em; vertical-align: 0.12em; }
#ink-ui.scene > .vitals, #ink-ui.scene > .line, #ink-ui.scene > .note { opacity: 0 !important; }
`,d=`
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <filter id="ink-edge" x="-10%" y="-10%" width="120%" height="120%">
    <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="4" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6"/>
  </filter>
  <filter id="ink-brush" x="-4%" y="-8%" width="108%" height="116%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.4" result="torn"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.016 0.42" numOctaves="2" seed="12" result="dry"/>
    <feColorMatrix in="dry" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -1.98" result="streaks"/>
    <feComposite in="torn" in2="streaks" operator="out"/>
  </filter>
  <filter id="ink-brush-pale" x="-4%" y="-8%" width="108%" height="116%">
    <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="3" result="warp"/>
    <feDisplacementMap in="SourceGraphic" in2="warp" scale="3" result="torn"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.014 0.4" numOctaves="2" seed="21" result="dry"/>
    <feColorMatrix in="dry" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -1.9" result="streaks"/>
    <feComposite in="torn" in2="streaks" operator="out"/>
  </filter>
</defs></svg>`,f=(e,t,n,r)=>{let i=document.createElement(t);return n&&(i.className=n),r&&(i.innerHTML=r),e.appendChild(i),i},p=null;function m(e){return new Promise((t,n)=>{let r=new Image;r.onload=()=>t(r),r.onerror=()=>n(Error(`[hud] could not load ${e}`)),r.src=e})}function h(e,t){let n=f(e,`canvas`,`wash`);n.width=o,n.height=s;let r=n.getContext(`2d`),i=r.createImageData(o,s),a=i.data;for(let e=0;e<a.length;e+=4)a[e]=4,a[e+1]=3,a[e+2]=3;let c=document.createElement(`canvas`);c.width=o,c.height=s;let l=c.getContext(`2d`,{willReadFrequently:!0});l.drawImage(t,0,0,o,s);let u=l.getImageData(0,0,o,s).data,d=new Uint8Array(o*s);for(let e=0;e<d.length;e++)d[e]=u[e*4];let p=new Uint8Array(256),m=-1;return{canvas:n,draw(e){if(e===m)return;if(m=e,e<=0){n.style.display=`none`;return}n.style.display=`block`;let t=e>=1?2:-.04+e*1.18;for(let e=0;e<256;e++){let n=t-e/255,r=Math.min(Math.max(n/.016,0),1),i=Math.min(Math.max((n+.07)/.07,0),1)*.42;p[e]=Math.max(r,i)*255}for(let e=0;e<d.length;e++)a[e*4+3]=p[d[e]];r.putImageData(i,0,0)}}}function g(e,t){let n=p.menuBox;n.innerHTML=``,n.className=`menu ${t.kind}${t.kind===`title`?``:` dim`}${t.wide?` wide`:``}`;let r=f(n,`div`,`body`),i=f(r,`div`,`head`);f(i,`h1`,``,t.heading),t.kind===`title`&&t.heading===`Sumiro`&&f(i,`span`,`seal`),t.note&&f(r,`div`,`sub`,t.note);let a=f(r,`ul`);p.rows=[];for(let n of t.items){if(n.type===`text`){let e=f(a,`div`,n.columns?`poems cols`:`poems`);n.poems.length||f(e,`div`,`poem`,n.empty);for(let t of n.poems)f(e,`div`,`poem`,t.join(`<br>`));continue}let t=f(a,`li`),r={item:n,li:t};if(n.type===`slider`){t.classList.add(`row`),f(t,`span`,``,n.label);let i=f(t,`span`,`bar`,`<i></i><b></b>`);r.fill=i.querySelector(`b`),i.addEventListener(`click`,t=>{let a=i.getBoundingClientRect(),o=(t.clientX-a.left)/a.width,s=n.min+(n.max-n.min)*Math.min(Math.max(o,0),1);n.set(Math.round(s/n.step)*n.step),x(e,`menuMove`),_(r),t.stopPropagation()})}else n.type===`toggle`?(t.classList.add(`row`),f(t,`span`,``,n.label),r.val=f(t,`span`,`val`)):t.textContent=n.label;_(r);let i=p.rows.length;t.addEventListener(`pointerenter`,()=>v(e,i)),t.addEventListener(`click`,()=>{v(e,i),y(e,r)}),p.rows.push(r)}p.def=t,v(e,0,!0),p.justOpened=!0,n.getBoundingClientRect(),n.classList.add(`on`)}function _(e){let{item:t}=e;if(t.type===`slider`){let n=(t.get()-t.min)/(t.max-t.min);e.fill.style.width=`${n*100}%`}else t.type===`toggle`&&(e.val.textContent=t.get()?`on`:`off`)}function v(e,t,n){if(!p.rows.length)return;let r=p.rows.length,i=(t%r+r)%r;(i!==p.sel||n)&&(p.sel=i,p.rows.forEach((e,t)=>e.li.classList.toggle(`sel`,t===i)),n||x(e,`menuMove`))}function y(e,t){let{item:n}=t;n.type!==`slider`&&(n.type===`toggle`?(n.set(!n.get()),_(t),x(e,`menuMove`)):(x(e,`menuConfirm`),n.on?.()))}function b(e,t,n){let{item:r}=t;if(r.type===`slider`){let i=Math.min(Math.max(r.get()+n*r.step,r.min),r.max);r.set(Math.round(i/r.step)*r.step),_(t),x(e,`menuMove`)}else r.type===`toggle`&&(r.set(!r.get()),_(t),x(e,`menuMove`))}var x=(e,t)=>e.registry.set(`audio.cue`,{name:t});function S(e){if(!p.def)return;if(p.justOpened){p.justOpened=!1;return}let{menu:t}=e.input;t.up&&v(e,p.sel-1),t.down&&v(e,p.sel+1);let n=p.rows[p.sel];n&&t.left&&b(e,n,-1),n&&t.right&&b(e,n,1),n&&t.confirm?y(e,n):t.back&&p.def?.back&&(x(e,`menuBack`),p.def.back())}function C(e){let t=p.vitals;if(!e){p.vitalsShown=null,t.classList.remove(`on`);return}let n=`${e.strokes}/${e.maxStrokes}/${e.drinks}/${e.maxDrinks}/${!!e.abilities?.inkStep}`;if(n!==p.vitalsShown){p.vitalsShown=n,p.strokes.innerHTML=``;for(let t=0;t<e.maxStrokes;t++){let n=f(p.strokes,`img`,t<e.strokes?``:`lost`);n.src=p.strokeUrls[t%p.strokeUrls.length],n.alt=``}p.gourds.innerHTML=``;for(let t=0;t<e.maxDrinks;t++){let n=f(p.gourds,`img`,t<e.drinks?``:`empty`);n.src=p.gourdUrl,n.alt=``}p.ink.classList.toggle(`on`,!!e.abilities?.inkStep)}}function w(e,t){t?(e.innerHTML=`<span>${t.replace(/[<>&]/g,``).replace(/(^|\. )([^.]+?) {2}/g,`$1<b>$2</b> `)}</span>`,e.classList.add(`on`)):e.classList.remove(`on`)}function T(e){let t=e.registry.get(`cat`),n=!!t?.found&&t.state!==`REUNITED`,r=t?.health??0,i=t?.maxHealth||1,a=t?.failBelow??0,o=n?`${r}/${i}/${a}`:`off`;if(o!==p.catShown&&(p.catShown!==null&&n&&(p.vitalsT=0),p.catShown=o,p.catbar.classList.toggle(`on`,n),n)){let e=Math.min(Math.max(r/i,0),1);p.catbar.querySelector(`img.front`).style.clipPath=`inset(0 ${((1-e)*100).toFixed(1)}% 0 0)`,p.catbar.querySelector(`.fur i`).style.left=`${(a/i*100).toFixed(1)}%`}let s=n&&r<=a+1;return s!==p.catLow&&(p.catLow=s,p.catbar.classList.toggle(`low`,s)),s||n&&!!t.fighting&&t.targetable?.()}async function E(e){if(e.input.scripted)return;let t=document.createElement(`style`);t.textContent=u,document.head.appendChild(t);let n=f(document.body,`div`);n.id=`ink-ui`,n.innerHTML=d;let r=t=>e.assets.url(t),a=[1,2,3,4,5].map(e=>r(`ui/stroke_${e}.png`)),[o]=await Promise.all([m(r(`ui/wash_map.png`)),...a.map(m),m(r(`ui/gourd.png`))]);n.style.setProperty(`--stroke`,`url("${a[0]}")`),n.style.setProperty(`--band`,`url("${a[2]}")`);let s=f(n,`div`,`veil`),c=f(n,`div`,`vitals`),_=f(c,`div`,`strokes`),v=f(c,`div`,`lower`),y=f(v,`div`,`gourds`);v.insertAdjacentHTML(`beforeend`,`<svg class="ink" viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" pathLength="100"/></svg>`);let b=f(c,`div`,`catbar`);b.innerHTML=`<svg viewBox="0 0 100 100"><path class="face" d="M19 44 L21 9 L42 27 Q50 25 58 27 L79 9 L81 44 Q88 78 50 90 Q12 78 19 44 Z" fill="#efe7d4" stroke="${i}" stroke-width="7" stroke-linejoin="round"/><circle cx="37" cy="54" r="5" fill="${i}"/><circle cx="63" cy="54" r="5" fill="${i}"/><path d="M50 33 q6 2 3 8 q-4 4 -7 -1 q-1 -6 6 -6" fill="none" stroke="#a8321f" stroke-width="4"/></svg><div class="fur"><img class="back" alt=""><img class="front" alt=""><i></i></div>`;let x=f(n,`div`,`line hint`),S=f(n,`div`,`line prompt`),T=f(n,`div`,`note`),E=f(n,`div`,`subtitle`),D=f(n,`div`,`menu`),O=h(n,o),k=f(n,`div`,`closing`),A=f(n,`div`,`card`,`<div class="num"></div><div class="name"></div><div class="sub"></div><span class="seal"></span><div class="tally"></div>`),j=f(n,`div`,`credits`,`<div class="roll"></div><div class="end"><div class="name">Sumiro</div><div>The road goes on past this page.<br>The rest of it is still wet.</div><div class="soft">Enter</div></div>`);p={root:n,style:t,veil:s,vitals:c,strokes:_,gourds:y,ink:v.querySelector(`svg.ink`),inkCircle:v.querySelector(`svg.ink circle`),hint:x,prompt:S,note:T,subtitle:E,subT:0,menuBox:D,wash:O,card:A,closing:k,credits:j,rollAnim:null,strokeUrls:a,gourdUrl:r(`ui/gourd.png`),def:null,rows:[],sel:0,justOpened:!1,p:0,tween:null,timers:[],hintT:0,noteT:0,vitalsT:0,vitalsShown:null,playing:!1,chargeShown:-1,lastV:null,catbar:b,catShown:null,catLow:!1};for(let e of b.querySelectorAll(`img`))e.src=a[2];let M=e=>new Promise(t=>p.timers.push({left:e,resolve:t}));e.registry.set(`hud`,{wash(e,t){return p.tween?.resolve(),new Promise(n=>{p.tween={from:p.p,to:e,t:0,seconds:t,resolve:n}})},wait:M,revealVista(){p.veil.style.opacity=0,M(1.8).then(()=>p.veil.remove())},menu(t){g(e,t)},closeMenu(){p.def=null,p.rows=[],p.menuBox.classList.remove(`on`)},showCard(e){p.card.querySelector(`.num`).textContent=e.numeral,p.card.querySelector(`.name`).textContent=e.title,p.card.querySelector(`.sub`).textContent=e.line??``,p.card.querySelector(`.tally`).textContent=e.tally??``,p.card.classList.add(`on`)},hideCard(){p.card.classList.remove(`on`)},showClosing(e){p.closing.textContent=e,p.closing.classList.add(`on`)},hideClosing(){p.closing.classList.remove(`on`)},showCredits(e){let t=p.credits.querySelector(`.roll`),n=p.credits.querySelector(`.end`),r=e.chapters.map(e=>`<div class="ch"><i>${e.numeral}</i>${e.title}<small>${e.found} of ${e.total}</small></div>`).join(``),i=e.found>=e.total?`<div>Every scroll on the mountain, found.</div>`:``;t.innerHTML=`<h2>THE ROAD</h2>${r}<h2>SCROLLS</h2><div>${e.found} of ${e.total}</div>${i}<h2>TIME ON THE ROAD</h2><div>${e.minutes} minute${e.minutes===1?``:`s`}</div><h2>SUMIRO</h2>${e.lines.map(e=>`<div>${e}</div>`).join(``)}`,n.classList.remove(`on`),p.credits.classList.add(`on`);let a=p.credits.clientHeight+t.offsetHeight;p.rollAnim=t.animate([{transform:`translateY(0)`},{transform:`translateY(${-a}px)`}],{duration:3e4,fill:`forwards`}),p.rollAnim.onfinish=()=>n.classList.add(`on`)},creditsNext(){let e=p.credits.querySelector(`.end`);return e.classList.contains(`on`)?!0:(p.rollAnim?.finish(),e.classList.add(`on`),!1)},hideCredits(){p.credits.classList.remove(`on`),p.rollAnim?.cancel(),p.rollAnim=null},setPlaying(e){p.playing=e,e||(w(p.prompt,null),w(p.hint,null),p.hintT=0)},setVitals(e){p.lastV=e,p.vitalsT=0,C(e)},hint(e,{ms:t=3500}={}){w(p.hint,e),p.hintT=t/1e3,p.hintText=e||null},unhint(e){return!(p.hintT>0)||!p.hintText?.startsWith(e)?!1:(w(p.hint,null),p.hintT=0,!0)},prompt(e){w(p.prompt,e)},note(e,t){p.note.innerHTML=`${e.join(`<br>`)}${t?`<small>${t}</small>`:``}`,p.note.classList.add(`on`),p.noteT=8},subtitle(t,{speaker:n=null,ms:r=3e3,voice:i=null}={}){if(!t){p.subtitle.classList.remove(`on`),p.root.classList.remove(`speaking`),p.subT=0,e.registry.set(`subtitle`,null);return}let a=e=>e.replace(/[<>&]/g,``),o=l[n];p.subtitle.innerHTML=`<span>${o?`<small>${a(o)}</small>`:``}${a(t)}</span>`,p.subtitle.classList.toggle(`bar`,p.root.classList.contains(`scene`)),p.subtitle.classList.add(`on`),p.root.classList.add(`speaking`),p.subT=r/1e3,e.registry.set(`subtitle`,{text:t,speaker:n,voice:i})},scene(e){p.root.classList.toggle(`scene`,!!e),e&&p.subtitle.classList.add(`bar`)}})}function D(e,t){if(!p)return;if(e>0){if(p.tween){let t=p.tween;t.t+=e;let n=t.seconds>0?Math.min(t.t/t.seconds,1):1;p.p=t.from+(t.to-t.from)*(n*n*(3-2*n)),n>=1&&(p.tween=null,t.resolve())}for(let t=p.timers.length-1;t>=0;t--)p.timers[t].left-=e,p.timers[t].left<=0&&p.timers.splice(t,1)[0].resolve();p.hintT>0&&(p.hintT-=e,p.hintT<=0&&w(p.hint,null)),p.noteT>0&&(p.noteT-=e,p.noteT<=0&&p.note.classList.remove(`on`)),p.subT>0&&!t.paused&&(p.subT-=e,p.subT<=0&&(p.subtitle.classList.remove(`on`),p.root.classList.remove(`speaking`),t.registry.set(`subtitle`,null)))}p.wash.draw(Math.max(p.p,t.registry.get(`player.fade`)??0)),e>0&&S(t);let n=T(t);if(p.lastV&&t.registry.get(`game.state`)===`PLAY`){let r=p.lastV.strokes<=2||n;p.vitalsT+=e,p.vitals.classList.toggle(`on`,r||p.vitalsT<c);let i=t.registry.get(`player.inkCharge`)??1;i!==p.chargeShown&&(p.chargeShown=i,p.inkCircle.setAttribute(`stroke-dasharray`,`${i*100} 100`),p.ink.classList.toggle(`full`,i>=1),i<1&&(p.vitalsT=Math.min(p.vitalsT,3.5)))}else p.vitals.classList.remove(`on`)}function O(e){p&&=(p.root.remove(),p.style.remove(),e.registry.delete(`hud`),null)}export{r as budgetMs,O as dispose,E as init,e as name,t as order,D as update,n as whilePaused};