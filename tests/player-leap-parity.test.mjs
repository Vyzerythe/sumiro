import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { createLedgePath } from '../src/player/ledge-path.mjs';
import {
  resolveLeapRim, resolveLeapTarget, findLeapLink,
  beginLeap, advanceLeap, abortLeap,
} from '../src/player/leap.mjs';
import { pointInPolygon } from '../src/physics/geometry.mts';

const published=await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js',import.meta.url),'utf8');
const section=published.match(/function st\(e\)\{[\s\S]*?\}(?=function pt\(e=1\)\{)/);
assert.ok(section,'published leap subsystem boundary changed; re-audit');
const clone=value=>structuredClone(value);
const wrap=x=>{let a=(x+Math.PI)%(Math.PI*2);if(a<0)a+=Math.PI*2;return a-Math.PI};
const clamp=(x,a,b)=>Math.min(Math.max(x,a),b);
const clean=value=>JSON.parse(JSON.stringify(value,(key,v)=>{
  if(key==='ledge'&&v?.id)return {id:v.id};
  if(key==='body'&&v?.id)return {id:v.id};
  if(key==='link'&&v?.id)return {id:v.id};
  return v;
}));

function scenario(overrides={}) {
  return {
    state:'RUN',stateT:0,x:0,y:1,z:0,
    vx:2,vz:0,vy:0,speed:3,
    heading:0,stickMag:1,stickX:1,stickZ:0,
    recentSpeed:5,grounded:true,guardsInAir:false,fromY:0,coyote:0,
    leap:null,carrier:null,
    ...overrides,
  };
}
function createHarness(state,options={}) {
  const events=[],view={kind:null,p:0},scratch={x:0,y:0,z:0};
  const collision={x:0,z:0,nx:1,nz:0};
  const config={leapMaxSpeed:9.6,leapGravity:18};
  const link={id:'leap',time:.75,clip:'wall_leap'};
  const target={x:4,y:2,z:2,ledge:null,body:null,local:null};
  const y={
    play:(name,opts)=>events.push(['play',name,clean(opts)]),
    duration:()=>1.5,
    finished:()=>!!options.finished,
    top:()=>({name:options.top??'jump'}),
  };
  const q=state,K=view, k=config, E=collision;
  const J=name=>{events.push(['state',name]);q.state=name;q.stateT=0};
  const qt=(...args)=>events.push(['footstep',...args]);
  const Re=()=>events.push(['headingLock']);
  const Ue=()=>events.push(['deflect']);
  const St=(ledge,distance)=>events.push(['grab',ledge.id,distance]);
  const bt=height=>events.push(['land',height]);
  const v={sweepCapsule:(state,dx,dz,opts,result)=>{
    events.push(['sweep',dx,dz]);
    result.x=state.x+dx+(options.blocked?.5:0);
    result.z=state.z+dz;
  }};
  const De={radius:.2,height:1.5,guards:false,solid:true};
  const original=runInNewContext(section[0]+';({ut,dt,ft})',{
    q,K,k,Re,y,qt,J, E,Ue,St,bt,v,De,O:scratch,j:.26,A:2.1,Oe:.88,
    B:wrap,V:clamp,c:pointInPolygon,
  });
  const effects={
    play:y.play,duration:y.duration,finished:y.finished,top:y.top,
    lockHeading:Re,footstep:qt,changeState:J,deflect:Ue,
    collision:E,world:v,capsule:De,collisionUntil:.88,
    scratch,ledgeOffset:.26,hangingHeight:2.1,grab:St,land:bt,
    abort:()=>abortLeap(q,K,k,effects),
  };
  return {q,K,k,events,link,target,original,effects};
}

function compareLifecycle(initial, opts, stepTimes) {
  const a=createHarness(scenario(initial),opts);
  const b=createHarness(scenario(initial),opts);
  a.original; // Reference must use its own closure and state objects.
  const targetA=clone(a.target),targetB=clone(b.target);
  beginLeap(a.q,a.K,a.link,targetA,a.k,a.effects);
  b.original.ut(b.link,targetB);
  assert.deepEqual(clean(a.q),clean(b.q),'begin leap');
  assert.deepEqual(clean(a.K),clean(b.K));
  assert.deepEqual(a.events,b.events);
  for(const seconds of stepTimes) {
    if (!a.q.leap || !b.q.leap) {
      assert.equal(!!a.q.leap, !!b.q.leap, 'different leap completion/abort state');
      break;
    }
    a.q.stateT=b.q.stateT=seconds;
    const aOld=a.events.length,bOld=b.events.length;
    advanceLeap(a.q,a.K,.016,a.k,a.effects);
    b.original.dt(.016);
    assert.deepEqual(clean(a.q),clean(b.q),'flight t='+seconds);
    assert.deepEqual(clean(a.K),clean(b.K));
    assert.deepEqual(a.events.slice(aOld),b.events.slice(bOld));
  }
}

test('leap initiation, flight interpolation and collision abort match reference',()=>{
  const cases=[
    [{}, {},[0,.05,.2,.5,.75,1]],
    [{state:'HANG',x:-1,y:3,z:1}, {},[0,.2,.8]],
    [{state:'GRAB',heading:2.2}, {finished:true},[0,.2,.75]],
    [{state:'SHIMMY',heading:-2}, {},[0,.2,.75]],
    [{}, {blocked:true},[.2]],
    [{}, {top:'fall'},[.2,.6]],
  ];
  for (const [state,options,frames] of cases) compareLifecycle(state,options,frames);
});

test('explicit interrupted-leap physics and effects match published fall path',()=>{
  const a=createHarness(scenario(),{}),b=createHarness(scenario(),{});
  beginLeap(a.q,a.K,a.link,clone(a.target),a.k,a.effects);
  b.original.ut(b.link,clone(b.target));
  a.events.length=0;b.events.length=0;
  a.q.stateT=b.q.stateT=.4;
  a.effects.collision.x=b.effects.collision.x=1.2;
  a.effects.collision.z=b.effects.collision.z=2.3;
  abortLeap(a.q,a.K,a.k,a.effects);
  b.original.ft();
  assert.deepEqual(clean(a.q),clean(b.q));
  assert.deepEqual(clean(a.K),clean(b.K));
  assert.deepEqual(a.events,b.events);
});

test('ledge rim endpoint clamping and land-target selection retain original semantics',()=>{
  const ledge=createLedgePath({id:'rim',points:[[0,2,0,0,1],[3,2,0,0,1],[6,2,0,0,1]]});
  const ledges=new Map([['rim',ledge]]);
  const world={
    body:()=>null,groundAt:()=>({y:3}),
  };
  const direction={x:1,z:0};
  const original=runInNewContext(section[0]+';({st,$})',{
    q:scenario(),C:ledges,O:{},U:direction,v:world,j:.26,A:2.1,
    V:clamp,ot:()=>{},
  });
  for(const frame of [-3,0,1,4,10]) {
    assert.equal(resolveLeapRim(ledge,frame),original.$(ledge,frame));
  }
  for(const link of [
    {to:{ledge:'rim',sFrom:1,sTo:5}},
    {to:{ledge:'rim',sFrom:1,sTo:5},fromLedge:'other'},
    {to:{land:[4,3],spread:2}},
  ]) {
    const actual=resolveLeapTarget(scenario(),link,ledges,world,direction,{});
    const expected=original.st(link);
    assert.deepEqual(clean(actual),clean(expected));
  }
});

test('leap link discovery respects authored region, speed and facing limits',()=>{
  const ledge=createLedgePath({id:'rim',points:[[0,2,0,0,1],[3,2,0,0,1]]});
  const ledges=new Map([['rim',ledge]]);
  const world={body:()=>null,groundAt:()=>({y:0})};
  const links=[
    {id:'outside',from:{poly:[[10,10],[12,10],[12,12],[10,12]]},
      to:{land:[10,10],spread:1},maxAngle:90,minSpeed:1},
    {id:'forward',from:{poly:[[-1,-1],[2,-1],[2,2],[-1,2]]},
      to:{land:[5,0],spread:1},maxAngle:85,minSpeed:2},
  ];
  const q=scenario();
  const direction={x:1,z:0};
  const old=runInNewContext(section[0]+';({ct})',{
    q,U:direction,f:{leapLinks:links},v:world,O:{},C:ledges,
    c:pointInPolygon,ot:()=>{},st:link=>resolveLeapTarget(q,link,ledges,world,direction,{}),
    V:clamp,
  });
  const found=findLeapLink(q,{leapLinks:links},ledges,world,direction,{},
    link=>resolveLeapTarget(q,link,ledges,world,direction,{}));
  assert.deepEqual(clean(found),clean(old.ct()));
});
