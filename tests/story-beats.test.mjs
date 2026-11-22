import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createStoryBeats, lanternRest, quietStoryBeats, swordReveal } from '../src/application/story-beats.mts';
import { createLanternRestScene } from '../src/application/lantern-rest-scene.mts';

async function declarations(filename) {
  const url = new URL(`../sumiro/bundle/${filename}`,import.meta.url);
  const ast = ts.createSourceFile(filename,await readFile(url,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const nodes = ast.statements.flatMap(statement => ts.isVariableStatement(statement)
    ? [...statement.declarationList.declarations] : [statement]);
  const find = name => {
    const node = nodes.find(entry => entry.name?.getText(ast) === name);
    assert.ok(node,name);
    return node;
  };
  return {
    exact: name => find(name).getText(ast),
    property: (name,key) => find(name).initializer.properties.find(p => p.name?.getText(ast) === key).initializer.getText(ast),
    object(id) {
      let result;
      function scan(node) {
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property => property.name?.getText(ast) === 'id' &&
          ts.isPropertyAssignment(property) && property.initializer.text === id)) result = node.getText(ast);
        else ts.forEachChild(node,scan);
      }
      scan(ast);
      assert.ok(result,id);
      return result;
    },
  };
}

const cutscenes = await declarations('cutscene-BTqk4hMj.js');
const chapterTwo = await declarations('ch2_pass-9Opjv4P2.js');
const chapterThree = await declarations('ch3_pines-BCHma7IG.js');
const { exact } = cutscenes;
const originalShrine = Function(`return (${chapterThree.property('q','shrines')})[0];`)();
const line = ({text,parts,voice,speaker}) => ({voice,speaker,parts:parts??[text]});
const constants = (names, source = exact) => 'const ' + names.map(source).join(',') + ';';
const makeBarks = Function('Ht',`${constants(['Ut','Wt','Gt','Kt','Pt','Ft','It','Rt','zt'])}
  ${['Bt','Vt','qt','Jt','Yt'].map(exact).join('\n')}
  return {definitions:Ut, create:Yt, fallback:Bt};
`)(env => ({
  start({voice,text}) {
    env.events.push(['voice',voice,text]);
    return { spoken:null, done:() => true };
  },
  stop(){env.events.push(['stop']);},
}));

const makeSword = Function(`${constants(['Fe'],chapterTwo.exact)} ${chapterTwo.exact('We')} return {command:We,line:Fe};`)();
const originalLanternStage = Function(`${exact('on')};return on;`)();

test('all authentic dialogue lines and cue IDs are present in the shipped manifest and level records', async () => {
  const views = makeBarks.definitions.map(({id,chapter,after,cue,when,line}) => {
    const flags = [];
    when?.({flag: flag => {flags.push(flag);return true;}});
    return {id,chapter,after,...(cue?{cue}:{}),...(flags.length?{flags}:{}),line};
  });
  assert.deepEqual(quietStoryBeats,views);
  assert.deepEqual(swordReveal.line,line(makeSword.line));
  const lanternLine = Function(`${constants(['xt'])} return xt;`)();
  assert.deepEqual(lanternRest.line,line(lanternLine));
  assert.deepEqual(lanternRest.shrine,originalShrine);
  const manifestURL = new URL('../sumiro/assets/audio/index.json',import.meta.url);
  const manifest = JSON.parse(await readFile(manifestURL,'utf8'));
  for (const { voice } of [...views.map(beat=>beat.line),swordReveal.line,lanternRest.line]) {
    assert.equal(manifest.voice[voice],`assets/audio/voice/${voice}.ogg`);
    const file = await readFile(new URL(`../sumiro/${manifest.voice[voice]}`,import.meta.url));
    assert.equal(file.subarray(0,4).toString(),'OggS',voice);
  }
});

function barkFixtures(chapter) {
  let playing = true, story = true, busy = false, cutscene = false, fighting = false;
  let cat = {carried:false,found:true,position:{x:5,z:0}};
  const player = {x:0,z:0};
  const flags = new Set(), nativeSeen = {}, oracleSeen = {};
  const nativeEvents = [], shippedEvents = [];
  const flag = id => flags.has(id);
  const scenario = {
    'level.current':{id:chapter},
    game:{get story(){return story;},flag,run:{seen:oracleSeen}},
    get 'game.state'(){return playing?'PLAY':'IDLE';},
    get subtitle(){return busy;},
    combat:{fighting:()=>fighting},
    'player.body':{c:player},
    get cat(){return cat;},
    hud:{subtitle(text,opts){shippedEvents.push(['subtitle',text,opts.voice,opts.ms]);}},
  };
  const oracle = makeBarks.create({events:shippedEvents,registry:{
    get: key => scenario[key],
    set: (key,event)=>shippedEvents.push(['cue',event.name]),
  }},{get active(){return cutscene;}});
  const native = createStoryBeats({
    hasFlag:flag, hasSeen:id=>Boolean(nativeSeen[id]), markSeen:id=>{nativeSeen[id]=true;},
    voice(value){nativeEvents.push(['voice',value.voice,value.parts.join(' ')]);},
    sound: cue=>nativeEvents.push(['cue',cue]),
    subtitle: value=>{if(value)nativeEvents.push(['subtitle',value.text,value.voice,value.ms]);},
  });
  native.enter(chapter);
  return {
    nativeEvents, shippedEvents, nativeSeen, oracleSeen,
    set(values) {
      ({playing=playing,story=story,busy=busy,cutscene=cutscene,fighting=fighting,cat=cat}=values);
      for (const f of values.flags ?? []) flags.add(f);
    },
    step(delta){
      oracle.update(delta);
      native.step(delta,{playing,story,sceneActive:cutscene,subtitleActive:busy,fighting,cat,player});
      assert.deepEqual(nativeSeen,oracleSeen);
      assert.equal(native.quietTime,oracle.state.quiet);
      assert.equal(native.activeVoice,oracle.state.line);
      assert.deepEqual(nativeEvents,shippedEvents.filter(event=>event[0]!=='stop'));
    },
  };
}

for (const beat of makeBarks.definitions) {
  test(`${beat.id} matches shipped quiet, combat, subtitle, companion and seen gating`,()=>{
    const f = barkFixtures(beat.chapter);
    f.step(beat.after + 1);
    f.set({cat:{carried:true,found:true}});
    if (beat.when) f.step(beat.after + 1);
    f.set({flags:['inkStep','cat_found','ch2_sword_wraith']});
    f.step(.6);
    f.set({fighting:true});
    f.step(1);
    f.set({fighting:false,busy:true});
    f.step(10);
    f.set({busy:false,playing:false});
    f.step(10);
    f.set({playing:true,cutscene:true});
    f.step(10);
    f.set({cutscene:false,cat:{carried:false,found:true,position:{x:4,z:0}}});
    f.step(beat.after - .05);
    assert.deepEqual(f.nativeEvents,[]);
    f.step(.05);
    if (beat.cue) {
      assert.deepEqual(f.nativeEvents,[['cue',beat.cue]]);
      f.step(.4);
      assert.equal(f.nativeEvents.length,1);
      f.step(.32);
    }
    for(let i=0;i<100;i++)f.step(.1);
    assert.equal(f.nativeEvents.filter(event=>event[0]==='voice').length,1);
    assert.deepEqual(f.nativeEvents.filter(event=>event[0]==='subtitle').map(event=>event[1]),beat.line.parts);
  });
}

test('the court bark is once per chapter instance and uses the original clear hint',()=>{
  const a=[],b=[];
  const c=createStoryBeats({
    voice: value=>{a.push(['line',value]);},
    hint: (text,ms)=>a.push(['hint',text,ms]),
  });
  c.enter('ch2_pass');
  const stage={court:{said:false}};
  const ctx={registry:{get:key=>key==='cutscene'?{say:v=>b.push(['line',line(v)])}:{hint:(v,{ms})=>b.push(['hint',v,ms])}}};
  for (const [type,id] of [['started','ridge'],['started','sword_wraith'],['started','sword_wraith'],['clear','sword_wraith']]) {
    c.onEncounter(type,id);
    makeSword.command({type,id},ctx,stage);
  }
  assert.deepEqual(a,b);
});

test('only the first Pines shrine queues the lantern scene and playback waits for clear PLAY',()=>{
  const a=[],b=[],nativeSeen={},shippedSeen={};
  let oldListener, playing=false, active=true;
  const level={id:'ch3_pines',shrines:[originalShrine]};
  let feet={x:-200,z:-200};
  const values={ 'level.current':level,game:{story:true,run:{seen:shippedSeen}},
    get 'game.state'(){return playing?'PLAY':'MENU';},
    get 'player.body'(){return {c:feet};} };
  const origin=originalLanternStage({registry:{
    get:key=>values[key],on(key,callback){oldListener=callback;return ()=>{oldListener=undefined;};},
  }},{get active(){return active;},play:(id,{shrine})=>b.push([id,shrine])},level);
  const controller=createStoryBeats({markSeen:key=>{nativeSeen[key]=true;},
    startLanternRest:({x,z,heading})=>a.push(['lantern_rest',{x,z,heading}])});
  controller.enter(level.id);
  function shrine(spot) { feet=spot;oldListener({name:'shrine'}); controller.onShrine(spot); }
  function step(){origin.update(); controller.step(.1,{playing,sceneActive:active}); assert.deepEqual(a,b);assert.deepEqual(nativeSeen,shippedSeen);}
  shrine(feet);step();
  shrine({x:-7.5,z:-201});step();
  assert.deepEqual(a,[]);
  active=false;
  step();
  playing=true;
  step();
  assert.equal(a.length,1);
  shrine({x:-11,z:-201});step();
  assert.equal(a.length,1);
  origin.leave();
  assert.equal(oldListener,undefined);
});

function canonical(command) {
  if (command.type === 'shot') return ['shot',command.shot.dur,command.blend,command.shot.keys.map(({pos,look})=>[pos,look])];
  if (command.type === 'line') return ['line',command.line.voice];
  if (command.type === 'sound') return ['cue',command.name];
  if (command.type === 'play' && command.actor === 'cat') return ['cat',command.clip,command.fade,command.then];
  if (command.type === 'attach') return ['attach',command.to];
}

const originalRest = Function(`
  ${constants(['Ie','Le','Fe','Ke','qe','B','Be','Ue','Ve','He','We','xt','A','Y','X','St','Ct','wt','Tt','kt'])}
  ${['Nt','Et','Dt','Ot','At','jt','Ye','Xe'].map(exact).join('\n')}
  function Je(){const st={k:0};return {st,hands:{},palms:{},follow(){},start(){st.k=0;}};}
  return {clock:Nt,script:${cutscenes.object('lantern_rest')}};
`)();

test('the lantern camera, purr, dialogue, curl, pickup and shoulder choreography match the shipped scene',()=>{
  let newTime=0;
  const interval=.005;
  const a=[],b=[];
  const camera=[-4,15,-190];
  const start=[-11,12,-197.6];
  const head=()=>1.57;
  let player=start;
  const snapshots=[];
  const clock=originalRest.clock();
  const orig=originalRest.script;
  const arms={lean(){},nod(){},hand(){},palm(){}};
  const cat={
    api:{carried:true},heading:head,*hopTo(){},*runTo(){},*turnTo(){},
    play:(clip,opts)=>b.push([clock.t,['cat',clip,opts.fade,opts.then]]),
    attach: to=>b.push([clock.t,['attach',to]]),
  };
  const him={c:{state:'IDLE',heading:1.57},*ready(){},feet:()=>player,at:()=>()=>player,
    *face(){},*walkTo(x,z){player=[x,player[1],z];},duration:()=>0,take:()=>null};
  const reference={
    cat,him,arms,seq:clock,opts:{shrine:originalShrine},state:{},get t(){return clock.t;},
    ctx:{camera:{position:{x:camera[0],y:camera[1],z:camera[2]}}},
    ground:()=>start[1],spawn:clock.start,wait:clock.wait,until:clock.until,
    shot:(shot,{blend=1}={})=>b.push([clock.t,canonical({type:'shot',shot,blend})]),
    cue: cue=>b.push([clock.t,['cue',cue]]),
    *line(value,{after}){b.push([clock.t,['line',value.voice]]);yield* clock.wait(makeBarks.fallback(value.text));yield* clock.wait(after);},
  };
  clock.start(orig.run(reference),true);
  while(clock.step(interval)) assert.ok(clock.t<30);
  assert.equal(clock.failed,false);
  player=start;
  const controller=createLanternRestScene({
    apply(command) {
      if (command.type==='walk' && command.actor==='player') player=[command.x,player[1],command.z];
      const encoded=canonical(command);
      if(encoded)a.push([newTime,encoded]);
    },
    point: actor=>actor==='camera'?camera:actor==='player'?player:start,
    heading:head, finish:result=>snapshots.push(result),
  });
  assert.equal(controller.start(),true);
  while(controller.active){newTime+=interval;controller.step(interval);assert.ok(newTime<30);}
  assert.equal(a.length,b.length);
  for(const [index,[time,command]] of a.entries()){
    assert.deepEqual(command,b[index][1]);
    assert.ok(Math.abs(time-b[index][0])<.03,`${command[0]} ${time} vs ${b[index][0]}`);
  }
  assert.deepEqual(snapshots,['completed']);
});

test('aborted narration and scene never deliver late dialogue or visual effects',()=>{
  const signals=[],text=[],results=[];
  const c=createStoryBeats({
    voice:(value,signal)=>{signals.push(signal);return {duration:()=>10};},
    subtitle:value=>text.push(value?.text??null),
  });
  c.enter('ch2_pass');
  c.onEncounter('started','sword_wraith');
  c.enter('ch3_pines');
  assert.equal(signals[0].aborted,true);
  c.step(30,{playing:true});
  assert.deepEqual(text,['Stay behind me.',null]);
  const lifetime=new AbortController();
  const scene=createLanternRestScene({
    begin:signal=>signals.push(signal),
    apply:command=>{if(command.type==='subtitle')text.push(command.text);},
    point:()=>[-11,12,-197.6],
    finish:result=>results.push(result),
  });
  assert.equal(scene.start(lanternRest.shrine,{carried:false}),false);
  scene.start(lanternRest.shrine,{signal:lifetime.signal});
  scene.step(.1);
  lifetime.abort();
  scene.step(30);
  assert.equal(signals[1].aborted,true);
  assert.deepEqual(text,['Stay behind me.',null]);
  assert.deepEqual(results,['cancelled']);
});
