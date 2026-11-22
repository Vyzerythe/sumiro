import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import {
  stepGroundContact, stepAirborne, finishLanding,
} from '../src/player/motion-physics.mts';
import { movementConfig } from '../src/player/movement-config.mts';

const published=await readFile(new URL('../sumiro/bundle/player-1_KrBWnI.js',import.meta.url),'utf8');
function get(pattern,label) {
  const matched=published.match(pattern);
  assert.ok(matched,'Published '+label+' boundary changed: re-audit');
  return matched[0];
}
const original={
  ground:get(/function ze\(e\)\{[\s\S]*?\}(?=function Be\(\)\{)/,'ground movement'),
  air:get(/function vt\(e\)\{[\s\S]*?\}(?=function yt\(\)\{)/,'air movement'),
  landing:get(/function bt\(e\)\{[\s\S]*?\}(?=function xt\(e\)\{)/,'landing'),
};
const normalize=x=>JSON.parse(JSON.stringify(x,(key,value)=>{
  if(key==='carrier'&&value?.id)return value.id;
  if(key==='body'&&value?.id)return value.id;
  return value;
}));
function initial(patch={}) {
  return {
    x:1,y:2,z:-3,vx:3,vz:-2,vy:-1,speed:3.6,
    stickX:.5,stickZ:-.4,stickMag:.6,heading:.3,
    state:'JUMP',stateT:.2,jumpCut:false,jumpBuf:0,
    grounded:false,guardsInAir:false,fromY:3,
    noGrab:0,carrier:null,drift:{x:.1,z:.2,air:.7},
    surface:'stone',lastGroundY:2,rootY:2,
    fade:0,dissolve:0,coyote:0,airDashed:false,
    landHeavy:false,
    ...patch,
  };
}
function fixture(kind,scenario={}) {
  const state=initial(scenario.state??{});
  const events=[],contact={x:state.x,z:state.z,hit:false,
    solid:false,nx:.5,nz:-.2,body:null,kind:0};
  const carrier={id:'raft',vx:1,vy:1.3,vz:.5};
  let groundCalls=0;
  const groundAt=(x,z,high,low)=>{
    groundCalls++;
    events.push(['ground',x,z,high,low]);
    const rule=scenario.ground??'all';
    if(rule==='none')return null;
    if(rule==='first'&&groundCalls>1)return null;
    if(rule==='later'&&groundCalls===1)return null;
    if(rule==='below'&&high<1)return null;
    return {y:scenario.groundHeight??0,surface:'water',body:scenario.carrier?carrier:null};
  };
  const world={
    groundAt,
    sweepCapsule:(start,dx,dz,options,out)=>{
      events.push(['sweep',dx,dz,options.radius,options.guards]);
      out.x=start.x+dx;
      out.z=start.z+dz;
      out.hit=!!scenario.hit;
      out.body=scenario.bodyHit?carrier:null;
      out.solid=!!scenario.solid;
      out.nx=.5;out.nz=-.2;
      return out;
    },
  };
  const changeState=value=>{
    events.push(['state',value]);state.state=value;state.stateT=0;
  };
  const play=(name,opts)=>events.push(['play',name,normalize(opts)]);
  const footstep=(...args)=>events.push(['footstep',...args]);
  const deflect=()=>events.push(['deflect']);
  const surfaceName=name=>scenario.pool?'ink':name;
  const shake=n=>events.push(['shake',n]);
  const sound=name=>events.push(['sound',name]);
  const hurt=reason=>events.push(['hurt',reason]);
  const die=()=>events.push(['die']);
  const land=height=>events.push(['land',height]);
  const grabLedge=()=>{events.push(['grab']);return !!scenario.grab};
  const tryWallMantle=()=>{events.push(['wall']);return !!scenario.wall};
  const probeMantle=()=>{events.push(['mantleProbe']);return scenario.mantle?{x:2,z:1}:null};
  const beginMantle=value=>events.push(['mantle',normalize(value)]);
  const updateFall=()=>events.push(['fallUpdate']);
  const hasSupport=()=>{events.push(['support']);return !!scenario.support};
  const hasSafeDrop=()=>{events.push(['safeDrop']);return !!scenario.safeDrop};
  const hasHigherGround=()=>{events.push(['higher']);return !!scenario.higher};
  const estimateNormal=()=>events.push(['normal']);
  const capsule={radius:.3,guards:false};
  const guardCapsule={radius:.3,guards:true};
  const effects={
    world,collision:contact,bodyCapsule:capsule,
    probeOffset:.35,hasSupport,hasSafeDrop,
    hasHigherGround,estimateNormal,deflect,surfaceName,
    normalCapsule:capsule,guardedCapsule:guardCapsule,
    jumpHeld:!!scenario.jumpHeld,
    groundTolerance:.35,play,changeState,grabLedge,
    land,tryWallMantle,probeMantle,beginMantle,updateFall,
    shake,sound,hurt,isDead:()=>!!scenario.dead,die,footstep,
    consumeBufferedJump:()=>events.push(['bufferedJump']),
  };
  const vm={
    q:state,k:movementConfig,v:world,G:capsule,E:contact,
    ke:.35,We:hasSupport,Ge:hasSafeDrop,Ke:hasHigherGround,
    X:estimateNormal,Ue:deflect,Y:surfaceName,
    m:{jumpHeld:!!scenario.jumpHeld},
    y:{play},J:changeState,B:x=>{
      let wrapped=(x+Math.PI)%(2*Math.PI);
      if(wrapped<0)wrapped+=2*Math.PI;
      return wrapped-Math.PI;
    },
    V:(x,a,b)=>Math.min(Math.max(x,a),b),
    Ee:guardCapsule,Te:capsule,L:.35,wt:grabLedge,
    bt:land,mt:tryWallMantle,pt:probeMantle,ht:beginMantle,yt:updateFall,
    Ie:shake,p:{set:(key,value)=>sound(value.name)},Ht:hurt,
    Fe:()=>!!scenario.dead,Bt:die,qt:footstep,_t:effects.consumeBufferedJump,
  };
  const functionName={ground:'ze',air:'vt',landing:'bt'}[kind];
  const reference=runInNewContext(original[kind]+';'+functionName,vm);
  return {state,events,effects,reference};
}
function compare(kind,scenario={},arg=.016) {
  const candidate=fixture(kind,scenario),baseline=fixture(kind,scenario);
  let actual;
  if(kind==='ground')actual=stepGroundContact(candidate.state,arg,movementConfig,candidate.effects);
  else if(kind==='air')actual=stepAirborne(candidate.state,arg,movementConfig,candidate.effects);
  else actual=finishLanding(candidate.state,arg,movementConfig,candidate.effects);
  const expected=baseline.reference(arg);
  assert.equal(actual,expected,'return value '+kind+' '+JSON.stringify(scenario));
  assert.deepEqual(normalize(candidate.state),normalize(baseline.state),
    'state divergence '+kind+' '+JSON.stringify(scenario));
  assert.deepEqual(normalize(candidate.events),normalize(baseline.events),
    'event divergence '+kind+' '+JSON.stringify(scenario));
}

test('ground sweep, support, guard and fall decisions match published controller',()=>{
  for(const scenario of [
    {},{ground:'none'},{ground:'later'},{ground:'first'},
    {ground:'none',hit:true},{ground:'none',support:true},
    {ground:'none',safeDrop:true},{ground:'none',higher:true},
    {ground:'all',hit:true,carrier:true},
  ]) for(const dt of [0,.016,.05,.2])compare('ground',scenario,dt);
});
test('air control, jump cut, guard contact, ledge detection and ground return match',()=>{
  for(const scenario of [
    {},{ground:'none'},{ground:'all',groundHeight:1.4},
    {ground:'none',grab:true},{ground:'none',wall:true,solid:true},
    {ground:'none',mantle:true},{hit:true},{jumpHeld:true},
    {pool:true,groundHeight:1.9},
  ]) for(const dt of [0,.016,.08,.2]) {
    compare('air',scenario,dt);
    compare('air',{...scenario,state:{state:'FALL',vy:-5,stickMag:0}},dt);
    compare('air',{...scenario,state:{state:'JUMP',vy:5,jumpCut:false}},dt);
  }
});
test('soft, heavy, fatal, moving-platform and buffered landings match',()=>{
  for(const height of [0,1.5,2.1,7,7.01,12]) for(const scenario of [
    {},{carrier:true},{dead:true},{carrier:true,dead:true},
    {state:{stickMag:1,vx:4,vz:2,jumpBuf:.1}},
  ])compare('landing',scenario,height);
});
test('deterministic randomized player physics inputs retain exact differential parity',()=>{
  let seed=0x54a178;
  const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const grounds=['none','all','later','first'];
  for(let i=0;i<180;i++) {
    const scenario={
      ground:grounds[Math.floor(rnd()*grounds.length)],
      hit:rnd()>.5,solid:rnd()>.5,carrier:rnd()>.8,
      jumpHeld:rnd()>.5,grab:rnd()>.94,wall:rnd()>.94,
      mantle:rnd()>.92,support:rnd()>.6,safeDrop:rnd()>.6,
      state:{
        vx:(rnd()-.5)*12,vz:(rnd()-.5)*12,
        vy:(rnd()-.5)*20,y:rnd()*8,stickMag:rnd(),
        jumpCut:rnd()>.5,state:rnd()>.5?'JUMP':'FALL',
      },
    };
    const type=['ground','air','landing'][i%3];
    compare(type,scenario,rnd()*.07);
  }
});
