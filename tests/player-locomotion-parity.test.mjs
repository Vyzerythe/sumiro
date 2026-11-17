import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  classifyGroundGait, selectTravelDirection, beginJump, beginFall,
} from '../src/player/locomotion.mjs';

const bundle = await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js', import.meta.url), 'utf8');
function extract(pattern, label) {
  const matched = bundle.match(pattern);
  assert.ok(matched, 'Missing published player function ' + label);
  return matched[0];
}
const gaitSource = extract(/function Qe\(\)\{[\s\S]*?\}(?=function \$e\()/, 'Qe');
const directionSource = extract(/function ot\(\)\{[\s\S]*?\}(?=function st\()/, 'ot');
const jumpSource = extract(/function at\(\)\{[\s\S]*?\}(?=function ot\()/, 'at');
const fallSource = extract(/function it\(e=0\)\{[\s\S]*?\}(?=function at\()/, 'it');

const config = {gravity:24, jumpHeight:1.3, coyote:.1};
function makeState() {
  return {
    state:'IDLE', stateT:.7, y:3, vx:0,vz:0,vy:0,
    heading:0, stickX:0,stickZ:0,stickMag:0,
    braking:false,recentSpeed:0,grounded:true,
    guardsInAir:false,jumpCut:true,fromY:0,coyote:.09,
  };
}
function sourceEffects(state, events) {
  return {
    detach:()=>events.push(['detach']),
    play:(name, options)=>events.push(['play',name,options]),
    footstep:(side,event,mute)=>events.push(['footstep',side,event,mute]),
    setState:(name)=>{events.push(['state',name]);state.state=name;state.stateT=0},
  };
}
function original(kind,state,out,events) {
  const eff = sourceEffects(state,events);
  const local = {
    q:state,k:config,U:out,Be:eff.detach,
    J:eff.setState,qt:eff.footstep,y:{play:eff.play},
  };
  const src = ({gait:gaitSource,direction:directionSource,jump:jumpSource,fall:fallSource})[kind];
  const name = ({gait:'Qe',direction:'ot',jump:'at',fall:'it'})[kind];
  return runInNewContext(src+';'+name,local)();
}
function compare(kind,initial) {
  const a=structuredClone(initial),b=structuredClone(initial);
  const ea=[],eb=[],outA={x:0,z:0},outB={x:0,z:0};
  const fx=sourceEffects(a,ea);
  let result;
  switch(kind) {
    case 'gait': result=classifyGroundGait(a);break;
    case 'direction':result=selectTravelDirection(a,outA);break;
    case 'jump':result=beginJump(a,config,fx);break;
    case 'fall':result=beginFall(a,config,fx);break;
  }
  const expected=original(kind,b,outB,eb);
  assert.equal(result,expected);
  assert.deepEqual(a,b,'state mismatch for '+kind+' '+JSON.stringify(initial));
  assert.deepEqual(outA,outB);
  assert.deepEqual(ea,eb);
}
test('gait thresholds match the published state transitions',()=>{
  for(const speed of [0,.1499999,.15,2.79999,2.8,7.09999,7.1,12]) {
    for(const state of ['IDLE','WALK','RUN','SPRINT','JUMP']) {
      compare('gait',{...makeState(),state,vx:speed, vz:0});
    }
  }
});

test('travel direction preserves input and facing fallbacks',()=>{
  for(const [vx,vz] of [[0,0],[1,0],[0,2],[5,-3],[-.1,.2]]) {
    for(const stickMag of [0,.05,.11,.5,1]) {
      compare('direction',{...makeState(),heading:.7,vx,vz,stickMag,stickX:-.4,stickZ:.2});
    }
  }
});

test('jump impulse, momentum inheritance, events and state transition match',()=>{
  for(const vx of [0,1,2.5,2.501,9]) {
    for(const braking of [true,false]) for(const state of ['IDLE','TEETER']) {
      compare('jump',{...makeState(),vx,vz:.75,braking,state,
        stickMag:.8,stickX:.4,stickZ:-.6,recentSpeed:8.2});
    }
  }
});

test('fall transition resets movement flags and triggers published effects',()=>{
  for(const vy of [0,-10,2]) {
    compare('fall',{...makeState(),vy,grounded:true,coyote:.05});
  }
});

test('seeded varied inputs retain exact movement transition parity',()=>{
  let seed=0xbdd177;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const types=['gait','direction','jump','fall'];
  for(let i=0;i<350;i++) {
    const initial={...makeState(),
      state:['IDLE','TEETER','WALK','RUN','SPRINT'][Math.floor(random()*5)],
      vx:(random()-.5)*17,
      vz:(random()-.5)*17,
      vy:(random()-.5)*10,
      heading:(random()-.5)*6,
      stickMag:random(),
      stickX:random()-.5,stickZ:random()-.5,
      recentSpeed:random()*12,
      braking:random()>.5,
      grounded:random()>.5};
    compare(types[i%types.length],initial);
  }
});
