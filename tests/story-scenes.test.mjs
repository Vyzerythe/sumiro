import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';
import { createStorySceneController, storySceneLines, storySceneSites } from '../src/application/story-scenes.mts';

async function declarations(filename) {
  const text = await readFile(new URL(`../sumiro/bundle/${filename}`,import.meta.url),'utf8');
  const ast = ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const entries = ast.statements.flatMap(item => ts.isVariableStatement(item) ? [...item.declarationList.declarations] : [item]);
  const entry = name => {
    const result = entries.find(item => item.name?.getText(ast) === name);
    assert.ok(result, name);
    return result;
  };
  return {
    exact: name => entry(name).getText(ast),
    property: (name,key) => entry(name).initializer.properties.find(member => member.name?.getText(ast) === key).initializer.getText(ast),
  };
}

const { exact } = await declarations('cutscene-BTqk4hMj.js');
const chapterOne = await declarations('ch1_climb-D1obDXnH.js');
const chapterSix = await declarations('ch6_summit-BczK7QHX.js');
const openAnchors = Function(`return ${chapterOne.property('Z','anchors')};`)();
const summitAnchors = Function(`const ${chapterSix.exact('H')}; return ${chapterSix.property('q','anchors')};`)();
const constants = ['A','Ze','Qe','$e','V','H','et','tt','U','W','G','K','at','ot','q','J','st','ct','lt','dt','vt','yt',
  'Ie','Le','Fe','Ke','qe','B','Be','Ue','Ve','He','We','Re','Ne','Pt','Ft','It','Rt','zt','rt','bt'];
const methods = ['Nt','it','ut','ft','pt','mt','ht','gt','_t','Ye','Xe','Bt','Vt'];
const original = Function(`
  const ${constants.map(exact).join(',')};
  ${methods.map(exact).join('\n')}
  const w={x:5.87,z:-59.16}, xe=(current,options)=>()=>current()??options.fallback;
  function Je() {
    const st={k:0};
    return {st, hands:{}, palms:{}, follow(){}, start(){st.k=0;}};
  }
  function* te() {}
  return {opening_cat:rt,reunion:bt,Nt,Bt,Vt,lines:{find:Ze,...W}};
`)();

const normalizeLine = line => [line.voice, line.parts ?? [line.text]];
const normalizedClip = (actor, clip, options) => [actor,clip,options.fade,options.then,!!options.loop];
const frame = .005;

function reference(id, carried) {
  const script = original[id], anchors = id === 'reunion' ? summitAnchors : openAnchors;
  const seq = original.Nt();
  const events = [];
  const note = (kind, value) => events.push({ time: seq.t, kind, value });
  const home = [anchors.reunion_family?.[0] - .1 + .37, 86.4, -350.3];
  let player = id === 'reunion' ? [-284,86.4,-350] : [6.25,8.313,-57.64];
  let cat = carried ? player : home;
  const him = {
    c: { state: 'IDLE', heading: Math.PI / 2, get x(){return player[0];}, get y(){return player[1];}, get z(){return player[2];} },
    feet: () => player, hold(){}, *ready(){}, *face(){}, duration: () => 0, take: () => null, pose: () => null,
    *walkTo(x,z){ player = [x,player[1],z]; }, faceAt: () => null,
  };
  const catActor = {
    api: { carried }, where: () => cat, heading: () => Math.PI / 2, head: () => null,
    play: (clip, opts) => note('clip', normalizedClip('cat',clip,opts)),
    place(x,z,heading,y){cat = [x,y,z];},
    attach: to => note('attach',to),
    *runTo(x,z){cat = [x,cat[1],z];},
  };
  const actors = Array.from({ length: 3 }, (_,i) => ({
    play: (clip, opts) => note('clip',normalizedClip(`family${i}`,clip,opts)), where: () => anchors.reunion_family,
  }));
  function* line(value,{after=.25}={}) {
    note('line',normalizeLine(value));
    const [duration] = [original.Bt(value.text)];
    yield* seq.wait(duration);
    yield* seq.wait(after);
  }
  const ctx = {
    seq, him, cat: catActor, arms: { hand(){}, palm(){}, weight: () => 1, nod(){}, lean(){} },
    state:{}, ground: (x,z,y) => y,
    get t(){return seq.t;}, get dt(){return seq.dt;},
    anchor: name => anchors[name], family: () => actors,
    wait: seq.wait, until: seq.until, all: seq.all, spawn: task => seq.start(task),
    *later(delay,perform){yield* seq.wait(delay);perform();},
    shot: (shot,{blend=1}={}) => note('shot',[shot.dur,blend]),
    flag: () => {}, cue: name => note('sound',name),
    line,
    speech(value) {
      const speech = { part: 0, done: false };
      seq.start((function*() {
        note('line',normalizeLine(value));
        const marks = original.Vt(value.parts);
        const from = seq.t;
        for (let index=0;index<value.parts.length;index++) {
          speech.part = index;
          while (seq.t-from < marks[index+1]) yield;
        }
        speech.part = value.parts.length;
        speech.done = true;
      })());
      return speech;
    },
  };
  seq.start(script.run(ctx),true);
  while (seq.step(frame)) assert.ok(seq.t < 45);
  assert.equal(seq.failed,false);
  return events;
}

function native(id, carried) {
  let player = id === 'reunion' ? [-284,86.4,-350] : [6.25,8.313,-57.64];
  let cat = carried ? player : [-293.4-.1+.37,86.4,-350.3];
  const finish = [];
  let time = 0;
  const events = [];
  const controller = createStorySceneController({
    point: (actor,mark) => mark ? undefined : actor === 'player' ? player : actor === 'cat' ? cat : summitAnchors.reunion_family,
    apply(command,signal) {
      assert.equal(signal.aborted,false);
      const { type } = command;
      if (type === 'walk' && command.actor === 'player') player = [command.x,player[1],command.z];
      if (type === 'walk' && command.actor === 'cat') cat = [command.x,cat[1],command.z];
      const value = type === 'line' ? normalizeLine(command.line) : type === 'sound' ? command.name :
        type === 'shot' ? [command.shot.dur,command.blend] : type === 'attach' ? command.to :
        type === 'play' && command.actor !== 'player' ? normalizedClip(command.actor,command.clip,command) : undefined;
      if (value !== undefined) events.push({ time, kind: type === 'play' ? 'clip' : type, value });
    },
    finish: outcome => finish.push(outcome),
  });
  assert.equal(controller.play(id,{carried}),true);
  while (controller.active) {
    time += frame;
    assert.ok(time < 45);
    controller.step(frame);
  }
  return { events, finish };
}

test('anchors and line text match the original cutscene and level declarations', () => {
  for (const [key, value] of Object.entries(openAnchors)) assert.deepEqual(storySceneSites.opening_cat[key],value);
  for (const [key, value] of Object.entries(summitAnchors)) assert.deepEqual(storySceneSites.reunion[key],value);
  for (const [key, value] of Object.entries(original.lines)) assert.deepEqual(normalizeLine(storySceneLines[key]),normalizeLine(value));
});

for (const [id,carried] of [['opening_cat',true],['reunion',true],['reunion',false]]) {
  test(`${id} actionable cue trace matches the published scene with carried=${carried}`,() => {
    const expected = reference(id,carried);
    const actual = native(id,carried);
    // Order within concurrent jobs can vary by the same fixed step. Compare each
    // observable stream in order, with a six-tick allowance for chained waits.
    for (const kind of ['shot','line','sound','clip','attach']) {
      const select = events => events.filter(event => event.kind === kind);
      const ea = select(actual.events), eo = select(expected);
      assert.deepEqual(ea.map(event => event.value),eo.map(event => event.value),kind);
      for (const [index, event] of ea.entries()) assert.ok(Math.abs(event.time-eo[index].time) <= frame * 6,
        `${kind} ${JSON.stringify(event.value)} at ${event.time} vs ${eo[index].time}`);
    }
    assert.equal(actual.finish.length,1);
    assert.equal(actual.finish[0].outcome,'completed');
    if (id === 'opening_cat') assert.equal(actual.finish[0].flag,'cat_found');
    else {
      assert.equal(actual.finish[0].reunite,true);
      assert.equal(actual.finish[0].family.length,3);
    }
  });
}

test('abort and skip invalidate in-flight effects, and only skip applies the end-of-scene state', () => {
  const outer = new AbortController();
  const finishes = [];
  const runs = [];
  let calls = 0;
  let actorReady = false;
  const controller = createStorySceneController({
    begin: (id, signal) => runs.push(signal),
    apply(command,signal) {
      assert.equal(signal.aborted,false);
      calls++;
      if (command.type === 'walk') return { done: () => actorReady };
    },
    finish: result => finishes.push(result),
  });
  controller.play('reunion',{signal:outer.signal});
  assert.equal(controller.play('opening_cat'),false);
  controller.step(.2);
  controller.step(.2);
  const count = calls;
  outer.abort();
  assert.equal(runs[0].aborted,true);
  assert.deepEqual(finishes,[{id:'reunion',outcome:'cancelled'}]);
  actorReady = true;
  controller.step(30);
  assert.equal(calls,count);
  assert.equal(controller.play('opening_cat',{signal:outer.signal}),false);
  assert.equal(controller.play('opening_cat'),true);
  controller.step(.01);
  assert.equal(controller.skip(),true);
  assert.equal(controller.skip(),false);
  assert.equal(runs[1].aborted,true);
  assert.deepEqual(finishes[1].player.point,openAnchors.cat_stand);
  assert.equal(finishes[1].flag,'cat_found');
  assert.equal(finishes[1].attach,'shoulder');
  controller.dispose();
  assert.equal(controller.play('reunion'),false);
});

test('an effect error ends the scene once and keeps subsequent delayed jobs from firing', () => {
  const results = [];
  let signal;
  const controller = createStorySceneController({
    begin: (scene,run) => {signal = run;},
    apply(command) {if (command.type === 'shot') throw Error('camera unavailable');},
    finish: value => results.push(value),
  });
  controller.play('opening_cat');
  assert.throws(() => controller.step(.2),/camera unavailable/);
  controller.step(20);
  assert.equal(controller.active,null);
  assert.equal(signal.aborted,true);
  assert.deepEqual(results,[{id:'opening_cat',outcome:'failed'}]);
});
