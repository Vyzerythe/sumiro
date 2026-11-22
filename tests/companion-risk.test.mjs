import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import {
  canHuntCompanion, chooseArcherTarget, companionArrowHits, companionFailureSeconds, companionFailureText,
  companionHunterCap, companionMeleeHits, companionProvocationSeconds, companionRiskDefaults,
  createCompanionRisk, resolveCompanionPressure, updateWraithTarget,
} from '../src/domain/companion-risk.mts';

async function readPublished(filename) {
  const url = new URL(`../sumiro/bundle/${filename}`, import.meta.url);
  const tree = ts.createSourceFile(filename, await readFile(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = tree.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [node]);
  function find(name, nodes = declarations) {
    const node = nodes.find(entry => entry.name?.getText(tree) === name);
    assert.ok(node,name);
    return node;
  }
  return {
    exact: name => find(name).getText(tree),
    nested(parent,name) {
      const node = find(parent);
      const local = node.body.statements.flatMap(statement => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : [statement]);
      return find(name,local).getText(tree);
    },
    method(parent,name) {
      const node = find(parent);
      const local = node.body.statements.flatMap(statement => ts.isVariableStatement(statement)
        ? [...statement.declarationList.declarations] : [statement]);
      return local.flatMap(statement => statement.initializer?.properties ? [...statement.initializer.properties] : [])
        .find(statement => statement.name?.getText(tree) === name).getText(tree);
    },
  };
}

const catBundle = await readPublished('cat-Kd4-3ZMc.js');
const combatBundle = await readPublished('combat-Dp_zXhrv.js');
const gameBundle = await readPublished('game-B5zfa1fm.js');
const constant = (bundle,names) => `const ${names.map(bundle.exact).join(',')};`;
const publishedCat = Function('environment',`
  ${constant(catBundle,['m','D','O','k','A','j','M','ae','oe','se','ce','H','U','W','G','K'])}
  ${catBundle.exact('N')}
  ${catBundle.exact('Oe')}
  function c() {
    return {points:[],clear(){},first(){return 0;},end(){return 0;},at(){},restart(){}};
  }
  return { config:m, controller: Oe({...environment,config:()=>m}) };
`);
const defaultFrame = { phase: 'IDLE', found: true, playing: true,
  position: { x: 0, y: 0, z: 0 }, player: { x: 0, y: 0, z: 0, alive: true } };

function lifecycleFixture() {
  const native = [], shipped = [];
  let frame = structuredClone(defaultFrame);
  const reference = publishedCat({
    player: () => frame.player, world: () => null, playing: () => frame.playing, cutscene: () => frame.cutscene,
    found: () => frame.found, time: () => 0, seen: () => false, anchor: () => null,
    cue: name => shipped.push({type:'cue',name}),
    hint: (text,ms) => shipped.push({type:'hint',text,ms}),
    fail: reason => shipped.push({type:'failed',reason}),
    model: {
      mount(){}, place(){}, gait(){},
      play(clip, { fade }) { if (['hide','sit'].includes(clip)) shipped.push({type:'terminal-pose',clip,fade}); },
      flinch: clip => shipped.push({type:'flinch',clip}),
    },
  });
  const controller = reference.controller;
  const actual = createCompanionRisk({emit: event => native.push(event)});
  const compare = () => {
    assert.equal(actual.health,controller.api.health);
    assert.equal(actual.maxHealth,controller.api.maxHealth);
    assert.equal(actual.targetable(frame),controller.api.targetable());
    assert.equal(actual.failure,controller.cat.failReason);
    assert.deepEqual(native,shipped);
  };
  return {
    actual, controller, reference, native, shipped,
    set(overrides) {
      frame = {...frame,...overrides};
      controller.machine.state = frame.phase;
      Object.assign(controller.cat,frame.position,{found:frame.found,fight:frame.fighting ? {from:{x:3,z:3}} : null});
    },
    step(seconds) { actual.step(seconds,frame); controller.update(seconds); compare(); },
    damage(amount,source) {
      const taken = actual.damage(frame,amount,source);
      assert.equal(taken,controller.api.damage(amount,source));
      compare();
      return taken;
    },
    heal() { actual.heal(); controller.api.heal(); compare(); },
    release() { actual.releaseFight(); controller.api.release(); compare(); },
  };
}

test('defaults and all vulnerable physical phases match the shipped targetability gates', () => {
  const f = lifecycleFixture();
  for (const [key,value] of Object.entries(companionRiskDefaults)) {
    assert.equal(value,f.reference.config[key],key);
  }
  const { actual, controller } = f;
  const phases = ['STRAY','CARRIED','PICKUP','PUTDOWN','JUMP_DOWN','FOLLOW','IDLE','SIT','WAIT_GAP','TO_HIDE','HIDE','SCRIPTED','FAILED','REUNITED'];
  const targeted = [];
  for (const phase of phases) for (const found of [false,true]) for (const playing of [false,true]) for (const cutscene of [false,true]) {
    const frame = {...defaultFrame,phase,found,playing,cutscene};
    f.set(frame);
    const eligible = actual.targetable(frame);
    assert.equal(eligible,controller.api.targetable(),JSON.stringify(frame));
    if (eligible) targeted.push(phase);
  }
  assert.deepEqual(targeted,['FOLLOW','IDLE','SIT','WAIT_GAP','TO_HIDE','HIDE']);
});

test('damage cooldown, shrine restoration, three-stroke boundary and terminal effects follow the original cat', () => {
  const f = lifecycleFixture();
  f.set(defaultFrame);
  assert.equal(f.damage(7),true);
  assert.equal(f.actual.health,3);
  assert.equal(f.actual.failure,null);
  f.step(.69);
  assert.equal(f.damage(1),false);
  f.heal();
  assert.equal(f.actual.health,10);
  assert.equal(f.damage(1),false,'Healing does not cut short the hit guard');
  f.step(.02);
  assert.equal(f.damage(8),true);
  assert.equal(f.actual.health,2);
  assert.equal(f.actual.failure,'cat_hurt');
  assert.equal(f.damage(1),false);
  assert.deepEqual(f.native.slice(-4),[
    {type:'terminal-pose',clip:'hide',fade:.2},{type:'flinch',clip:'hurt'},{type:'cue',name:'catHurt'},
    {type:'failed',reason:'cat_hurt'},
  ]);
  f.actual.reset();
  assert.equal(f.actual.health,10);
  assert.equal(f.actual.failure,null);
});

test('abandonment uses strict 3D distance thresholds, warning hysteresis and uninterrupted far time', () => {
  const f = lifecycleFixture();
  const player = (x,y=0,z=0) => ({player:{x,y,z,alive:true}});
  f.set({...defaultFrame,...player(18)});
  f.step(1);
  assert.deepEqual(f.native,[]);
  f.set(player(0,18.01));
  f.step(1);
  f.set(player(16));
  f.step(1);
  f.set(player(18.1));
  f.step(1);
  assert.equal(f.native.filter(event=>event.type==='hint').length,1);
  f.set(player(15.99));
  f.step(1);
  f.set(player(0,30));
  f.step(20);
  assert.equal(f.native.filter(event=>event.type==='hint').length,2);
  assert.equal(f.actual.failure,null);
  f.set(player(0,30.01));
  f.step(2.5);
  assert.equal(f.actual.failure,null);
  f.set({ playing:false });
  f.step(.1);
  f.set({ playing:true });
  f.step(2.5);
  assert.equal(f.actual.failure,null);
  f.step(.01);
  assert.equal(f.actual.failure,'cat_left');
});

test('combat, the post-fight grace, cutscenes and carry suppress leaving behind', () => {
  const f = lifecycleFixture();
  const player = {x:35,y:0,z:0,alive:true};
  f.set({...defaultFrame,phase:'CARRIED',player});
  f.step(10);
  assert.deepEqual(f.native,[]);
  assert.equal(f.damage(10),false);
  f.set({phase:'HIDE',fighting:true});
  f.step(12);
  assert.deepEqual(f.native,[]);
  f.release();
  f.set({phase:'IDLE',fighting:false});
  f.step(8);
  assert.equal(f.actual.failure,null);
  f.set({cutscene:true});
  f.step(10);
  f.set({cutscene:false,player:{...player,alive:false}});
  f.step(10);
  f.set({player});
  f.step(2.5);
  assert.equal(f.actual.failure,null);
  f.step(.1);
  assert.equal(f.actual.failure,'cat_left');
});

test('non-terminal hits request the right hide replan and game failure uses the authored death card', () => {
  const events = [];
  const risk = createCompanionRisk({emit:event=>events.push(event)});
  const source = {x:5,z:6};
  risk.damage({...defaultFrame,phase:'HIDE',fighting:true},1,source);
  risk.step(.7,defaultFrame);
  risk.damage({...defaultFrame,phase:'TO_HIDE',fighting:true},1,source);
  assert.deepEqual(events.filter(event=>event.type==='rehide'),[
    {type:'rehide',source,interrupt:true},{type:'rehide',source,interrupt:false},
  ]);
  const original = Function('A','E',`
    ${constant(gameBundle,['T','pe','de','fe'])}
    ${gameBundle.exact('X')}
    return {T,pe,X};
  `)((dummy,state)=>events.push(state), {hud:{hint:(text,{ms})=>events.push({text,ms})}});
  assert.deepEqual(companionFailureText,original.T);
  assert.equal(companionFailureSeconds,original.pe);
  const time = (companionFailureSeconds+1.5)*1000;
  for (const reason of ['cat_hurt','cat_left']) {
    original.X(null,reason);
    assert.deepEqual(events.slice(-2),['DEATH',{text:companionFailureText[reason],ms:time}]);
  }
});

const sourcePressure = Function('X',`${constant(combatBundle,['Lt'])}
  ${combatBundle.exact('Wt')}
  return Wt;
`);
const sourceCap = Function('Wt',`return ({${combatBundle.method('qt','catHunterCap')}}).catHunterCap;`);
const sourceTarget = Function('e','p','P','F',`
  ${constant(combatBundle,['Oe','Ee','De','H'])}
  ${combatBundle.nested('He','ne')}
  return ne;
`);

test('encounter pressure overrides, hunter caps and wraith interception match the shipped policy', () => {
  const enemy = {x:0,z:0};
  const encounter = {id:'test',def:{}};
  const X = {ctx:{params:{raw:{get:()=>100}}},encounters:[encounter],level:{combat:{}}};
  const originalPressure = sourcePressure(X);
  for (const chapter of [undefined,-1,0,.25,.4,.75,1,2,NaN]) for (const override of [undefined,-2,0,.55,1.2,NaN]) {
    X.level.combat.catPressure=chapter;
    encounter.def.catPressure=override;
    const actual=resolveCompanionPressure(chapter,override);
    assert.equal(actual,originalPressure({encounter:'test'}));
    assert.equal(companionHunterCap(actual),sourceCap(()=>actual)(null));
  }
  const provoke = Function(`${constant(combatBundle,['ke'])};return ke;`)();
  assert.equal(companionProvocationSeconds,provoke);
  for (const cat of [undefined,{x:0,z:3},{x:4,z:0}])
    for (const player of [{x:1,z:1},{x:0,z:2.5},{x:0,z:6},{x:5,z:8},{x:1.1,z:2.5},{x:9,z:0}])
      for (const pressure of [.1,.4,.8,1]) for (const hunters of [0,2,3])
        for (const target of ['player','cat']) for (const targetTime of [0,.3]) for (const provoked of [0,.4]) {
          const p = { ...enemy,target,targetT:targetTime,provoked };
          const original = sourceTarget({
            catTarget:()=>cat ? {position:cat} : null,catPressure:()=>pressure,catHunters:hunters,
            catHunterCap:sourceCap(()=>pressure),
          }, p,()=>({p:player,d:Math.hypot(player.x,player.z)}), next=>{
            if (next!==p.target) {p.target=next;p.targetT=1.6;}
          });
          original(.1);
          const output = updateWraithTarget({target,targetTime,provoked},{enemy,player,cat,pressure,hunters},.1);
          assert.deepEqual(output,{target:p.target,targetTime:p.targetT,provoked:p.provoked});
        }
  assert.equal(canHuntCompanion('ronin',1,true),false);
  assert.equal(canHuntCompanion('wraith',.8,false),false);
});

test('archers use the unoccluded player first and otherwise the cat within 20 m and the hunter cap', () => {
  const original = Function('e','p','P','G','F',`
    const K=()=>true,z=()=>{},R=()=>{},N=()=>{},q=()=>false;
    ${combatBundle.nested('He','Ge')}
    return Ge;
  `);
  const enemy = {x:0,y:0,z:0};
  for (const current of ['cat','player']) for (const playerVisible of [false,true]) for (const catVisible of [false,true])
    for (const pressure of [.3,.6,1]) for (const hunters of [0,1,2,3]) for (const metres of [19.99,20,20.01]) {
      const player = {x:0,y:0,z:10}, cat = {x:metres,y:0,z:0};
      const state = {...enemy,state:'CHASE',target:current,cooldown:1};
      original({
        catTarget:()=>({position:cat}),catHunters:hunters,catHunterCap:sourceCap(()=>pressure),
      },state,()=>({p:player,d:10,dx:0,dz:10,angle:0}), x=>x===0 ? playerVisible : catVisible,
      target=>{state.target=target;})(.1);
      assert.equal(chooseArcherTarget({current,enemy,cat,playerVisible,catVisible,pressure,hunters}),state.target);
    }
});

test('arrow sweep and melee volume use the shipped narrow cat hitbox', () => {
  const arrowOracle = Function(`${constant(combatBundle,['te'])}${combatBundle.exact('I')};return I;`)();
  const target = {x:0,y:2,z:0};
  const origin = {x:0,y:2,z:0};
  for (const x of [.1,.239,.24,.25]) for (const y of [1.95,1.96,2.37,2.38,2.39]) for (const delta of [0,1]) {
    const arrow = {x,y,z:3,vx:0,vy:0,vz:5};
    assert.equal(companionArrowHits(arrow,target,delta),arrowOracle(arrow,target,delta));
  }
  assert.equal(companionArrowHits({x:0,y:2.1,z:3,vz:5},target,1),true);
  const meleeOracle = Function('e','p','P','ee','Fe',`${combatBundle.nested('He','ue')};return ue;`);
  const wrap = angle => Math.atan2(Math.sin(angle),Math.cos(angle));
  for (const x of [0,.8,2.2]) for (const y of [2,3.59,3.61]) for (const z of [-2.5,-2.1,2.1]) {
    const position = {x,y,z};
    let hit = false;
    meleeOracle({blowOnCat(){hit=true;}}, {...origin,heading:0},()=>({p:{y:100},d:99,angle:0}),
      ()=>({position}),wrap)({hit:{reach:2.25,arc:60,dmg:1}});
    assert.equal(companionMeleeHits(origin,0,2.25,60,position),hit);
  }
});
