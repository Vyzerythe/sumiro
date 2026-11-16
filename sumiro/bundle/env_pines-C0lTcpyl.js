const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./layout-BxJUyHwJ.js","./rolldown-runtime-DK3Fl9T5.js","./rail-V5OV_nvf.js","./review_receiver-DXl2AIau.js","./index-DnHRwVtn.js","./ink_material-CrFtRYQr.js","./constants-BjlLV5tN.js"])))=>i.map(i=>d[i]);
import{n as e,o as t,s as n}from"./ink_material-CrFtRYQr.js";import{a as r,i,n as a,r as o,t as s}from"./cards-gb6epnqc.js";import{o as c}from"./rail-V5OV_nvf.js";import{A as l,B as u,D as d,F as f,I as p,J as m,L as h,N as g,P as _,R as v,V as y,_ as b,d as x,et as S,g as C,gt as w,ht as T,k as E,l as D,mt as O,nt as k,t as A}from"./index-DnHRwVtn.js";function j(e,t){let n=t.reduce((e,t)=>e+t.count,0),r=new Float32Array(n*3),i=new Float32Array(n*2),a=new Float32Array(n*4),o=new Float32Array(n*2),s=new Int32Array(n),c=0;return t.forEach((t,n)=>{let l=t.squash??.7;for(let u=0;u<t.count;u++,c++){let u=t.spread*Math.sqrt(e.next()),d=e.next()*Math.PI*2;r[c*3]=t.pos[0]+Math.cos(d)*u,r[c*3+1]=t.pos[1]+e.range(-.03,.03),r[c*3+2]=t.pos[2]+Math.sin(d)*u*l;let f=(t.az[0]+(e.next()+e.next()-1)*t.az[1])*Math.PI/180;i[c*2]=Math.sin(f),i[c*2+1]=Math.cos(f),a[c*4]=e.range(t.length[0],t.length[1]),a[c*4+1]=e.range(t.rise[0],t.rise[1]),a[c*4+2]=e.range(t.droop[0],t.droop[1]),a[c*4+3]=t.width*e.range(.7,1.3),o[c*2]=Math.floor(e.next()*t.col.length)%t.col.length,o[c*2+1]=e.range(.82,1.12),s[c]=n}}),{total:n,root:r,dir:i,shape:a,colour:o,tuftOf:s}}var M=5;function ee(){let e=[],t=[];for(let t=0;t<=M;t++){let n=t/M;e.push(-1,n,0,1,n,0)}for(let e=0;e<M;e++){let n=e*2;t.push(n,n+1,n+3,n,n+3,n+2)}let n=new x;return n.setAttribute(`position`,new d(e,3)),n.setAttribute(`normal`,new d(e.map((e,t)=>+(t%3==1)),3)),n.setAttribute(`uv`,new d(e.flatMap((e,t)=>t%3==0?[0,0]:[]),2)),n.setIndex(t),n}function te(t,n){let r=j(t.rng.fork(`env_pines_grass`),n),i=r.total,a=new _,o=ee();a.index=o.index;for(let e of[`position`,`normal`,`uv`])a.setAttribute(e,o.attributes[e]);a.setAttribute(`aShape`,new g(r.shape,4)),a.setAttribute(`aDir`,new g(r.dir,2));let s={value:0},c=e({preset:`cloth`,color:16777215,side:2,lineWeight:0,shadeTint:[.9,.9,.9],name:`pine_grass`}),l=c.onBeforeCompile;c.onBeforeCompile=(e,t)=>{l(e,t),e.uniforms.uTime=s,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
attribute vec4 aShape; // length, rise, droop, width
attribute vec2 aDir;
uniform float uTime;
uniform float uPxToRad;
uniform float uPxScale;`).replace(`#include <begin_vertex>`,`vec3 transformed;
{
  float t = position.y;
  vec3 o = instanceMatrix[3].xyz;
  float ph = o.x * 1.1 + o.z * 0.8 + aDir.x * 2.0;
  float wind = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25;
  float along = (1.0 - aShape.y * 0.4) * t + aShape.z * t * t * 0.9 + wind * 0.06 * t * t;
  float up = aShape.y * t - aShape.z * t * t * 0.75;
  vec3 d = vec3(aDir.x, 0.0, aDir.y);
  vec3 side = normalize(cross(d, vec3(0.0, 1.0, 0.0)));
  // Faces the viewer's side of the tuft, tapering to a hair.
  float w = aShape.w * (1.0 - t) * (1.0 - t * 0.2) + 0.004;
  vec3 mid = (d * along + vec3(0.0, up, 0.0)) * aShape.x;
  vec3 off = side * w + vec3(0.0, 0.0, w * 0.6);
  // Never under a pixel across, as the screen sees it: a hair far off, or a strip seen edge on, breaks into dots.
  // Where it is wider than that it is left as it was. Its world position: the mesh stands at the origin (env_pines.js).
  vec3 tang = d * ((1.0 - aShape.y * 0.4) + aShape.z * t * 1.8) + vec3(0.0, aShape.y - aShape.z * t * 1.5, 0.0);
  vec3 view = cameraPosition - (o + mid);
  vec3 across = cross(tang, view);
  float acrossLen = length(across);
  if (acrossLen > 1e-6) {
    across /= acrossLen;
    float seen = dot(off, across);
    float px = length(view) * uPxToRad / max(uPxScale, 1e-3);
    float need = 0.5 * px - abs(seen);
    if (need > 0.0) off += across * need * (seen < 0.0 ? -1.0 : 1.0);
  }
  transformed = mid + off * position.x;
}`)},c.customProgramCacheKey=()=>`ink3:pinegrass`;let d=new f(a,c,i),p=new u,m=new b,h=n.map(e=>e.col.map(e=>new b(e[0]/255,e[1]/255,e[2]/255)));for(let e=0;e<i;e++)p.makeTranslation(r.root[e*3],r.root[e*3+1],r.root[e*3+2]),d.setMatrixAt(e,p),m.copy(h[r.tuftOf[e]][r.colour[e*2]]).multiplyScalar(r.colour[e*2+1]),d.setColorAt(e,m);return d.instanceMatrix.needsUpdate=!0,d.instanceColor.needsUpdate=!0,d.frustumCulled=!1,d.castShadow=!1,d.receiveShadow=!1,d.name=`pine_grass`,{mesh:d,update(e){s.value=e},dispose(){a.dispose(),o.dispose(),c.dispose(),d.dispose()}}}async function ne(e){let[t,r]=await Promise.all([e.assets.loadJSON(`env_pines/dapple.json`),e.assets.loadTexture(`env_pines/dapple.png`)]);r.flipY=!1,r.generateMipmaps=!0,r.minFilter=h,r.magFilter=p,r.wrapS=r.wrapT=C,r.anisotropy=8,r.colorSpace=``,r.needsUpdate=!0;let i={tDepth:n.tDepth,uRes:n.uRes,tMask:{value:r},uInvViewProj:{value:new u},uBox:{value:new w(t.x0,t.z0,t.x1,t.z1)},uY:{value:new O(t.y0,t.y1)},uCore:{value:new T(...t.core)},uThin:{value:new T(...t.thin)},uTime:{value:0}},a=new k({glslVersion:E,uniforms:i,vertexShader:`
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,fragmentShader:`
      precision highp float;
      layout(location = 0) out vec4 outColor;
      uniform highp sampler2D tDepth;
      uniform sampler2D tMask;
      uniform vec2 uRes;
      uniform mat4 uInvViewProj;
      uniform vec4 uBox;
      uniform vec2 uY;
      uniform vec3 uCore, uThin;
      uniform float uTime;
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        float d = texture(tDepth, uv).r;
        if (d >= 1.0) discard;
        vec4 h = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
        vec3 P = h.xyz / h.w;
        vec2 q = (P.xz - uBox.xy) / (uBox.zw - uBox.xy);
        if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || P.y < uY.x || P.y > uY.y) discard;
        // The shadow of swaying needles shifts a hair, in world units, not per pixel.
        q += vec2(sin(uTime * 0.9 + P.x * 0.7), sin(uTime * 0.7 + P.z * 0.6)) * 0.0009;
        float m = texture(tMask, q).r;
        vec3 mul = mix(vec3(1.0), uThin, smoothstep(0.08, 0.34, m));
        mul = mix(mul, uCore, smoothstep(0.42, 0.72, m));
        outColor = vec4(mul, 1.0);
      }`,transparent:!0,depthTest:!1,depthWrite:!1,side:1,blending:5,blendEquation:100,blendSrc:208,blendDst:200,blendSrcAlpha:200,blendDstAlpha:201});a.name=`pine_dapple`;let o=t.x1-t.x0,s=t.z1-t.z0,c=t.y1-t.y0,l=new D(o,c,s),d=new y(l,a);d.position.set((t.x0+t.x1)/2,(t.y0+t.y1)/2,(t.z0+t.z1)/2),d.name=`pine_dapple`,d.frustumCulled=!1,d.renderOrder=10;let f=new u;return{mesh:d,beforeRender(e){e.camera.updateMatrixWorld(),f.multiplyMatrices(e.camera.projectionMatrix,e.camera.matrixWorldInverse),i.uInvViewProj.value.copy(f).invert(),i.uTime.value=e.time.t},dispose(){l.dispose(),a.dispose(),r.dispose()}}}var re=1.8,N=(e,t,n)=>{let r=Math.min(Math.max((n-e)/(t-e),0),1);return r*r*(3-2*r)};function ie(e,t,n=1/0,r=16){let[i,a]=t,o=i<=0?1:N(i-r,i,e),s=a>=n?1:1-N(a,a+r,e);return Math.min(o,s)}function ae(e,t,n=re){return t?1-N(t,t+n,e):1}var oe=`env_pines`,se=40,P=`ch1_climb`,F=.6,I=`env_pines`,L={hero:`card_hero`,wide:`card_wide`,near:`card_near`,dab:`card_dab`},R=null,z=null,B=null,V=null,H=[],U=[],W=[],G={uWindT:{value:0}},ce={pale_behind:11.2},K=1/0,le=352/Math.tan(20*Math.PI/180),q={dx:0,dy:0,s:1};function ue(e,t){if(q.dx=q.dy=0,q.s=1,!e?.length)return q;let n=0;for(;n<e.length-2&&t>e[n+1][0];)n++;let r=e[n],i=e[Math.min(n+1,e.length-1)],a=i[0]>r[0]?v.clamp((t-r[0])/(i[0]-r[0]),0,1):0;return q.dx=r[1]+(i[1]-r[1])*a,q.dy=r[2]+(i[2]-r[2])*a,q.s=r[3]+(i[3]-r[3])*a,q}function de(e,t){let n={},r=null,i=1/0,a=-1/0;for(let o=t[0];o<=t[1];o+=2){c(o/24,n);let t=Math.atan2(n.x-e.x,n.z-e.z);r??=t,t=r+v.euclideanModulo(t-r+Math.PI,Math.PI*2)-Math.PI,i=Math.min(i,t),a=Math.max(a,t)}return(i+a)/2}var J=new u,Y=new T,X=new m,Z=new T,Q=new b;function fe(e,t,n,i,a){let o=new f(e,t,n.length);for(let e=0;e<n.length;e++){let t=n[e];Y.set(t[0],t[1],t[2]),X.set(t[3],t[4],t[5],t[6]),a&&r(X,e),Z.setScalar(a?t[7]*s:t[7]),J.compose(Y,X,Z),o.setMatrixAt(e,J);let i=v.clamp(t[8],.05,1.5);Q.setRGB(i,i,i),o.setColorAt(e,Q)}return o.instanceMatrix.needsUpdate=!0,o.instanceColor&&(o.instanceColor.needsUpdate=!0),o.castShadow=i,o.receiveShadow=!1,o.frustumCulled=!1,o}async function $(e,t){let n=await e.assets.loadTexture(`${I}/${t}`);return n.flipY=!1,n.wrapS=n.wrapT=S,n.anisotropy=8,n.generateMipmaps=!0,n.minFilter=h,n.magFilter=p,n.colorSpace=``,n.needsUpdate=!0,W.push(n),n}async function pe(n){let[r,s,c,u,d]=await Promise.all([n.assets.loadGLTF(`${I}/pines.glb`),n.assets.loadJSON(`${I}/placement.json`),$(n,`tufts.png`),$(n,`bark.png`),$(n,`bark_root.png`)]);c.wrapS=c.wrapT=C,R=new l,R.name=`env_pines`,n.scene.add(R);let f=new Map;r.scene.updateMatrixWorld(!0),r.scene.traverse(e=>{e.isMesh&&f.set(e.name,e)});let p={preset:`pineTrunk`,color:16777215,side:0,shadeTint:[.56,.56,.58],wrap:.5,skyFill:.45,lineWeight:.8},m=e({...p,map:u,name:`pine_bark`}),h=e({...p,map:d,name:`pine_root`,shadeTint:[.8,.8,.8],color:new b(1.22,1.22,1.22)}),g=a(o(e({...p,map:u,name:`pine_near`}),new T(.27,.26,.24),.38)),_=e({preset:`pineTrunk`,color:1907738,lineWeight:.15,name:`pine_twig`}),v=a(e({preset:`pineTrunk`,color:2367773,lineWeight:.2,name:`pine_far`,shadeTint:[.6,.6,.62]})),x=i(c,G),S=new T(.6,.56,.47),w=a(o(e({preset:`pineTrunk`,color:2367773,lineWeight:.1,name:`pine_pale`}),S,.34)),E=o(i(c,G),S,.34);W.push(m,h,g,_,v,w,x,E),K=Math.max(...Object.values(s.trees).map(e=>e.show[1]));for(let[e,r]of Object.entries(s.trees)){let i=new l;i.name=`pine_${e}`;let a=!!r.static,o=r.pale>0;for(let e of r.mesh){let t=f.get(e);if(!t){console.warn(`[env_pines] no mesh ${e}`);continue}let n=new y(t.geometry,m);e===`hero_roots`?n.material=h:e===`hero_twigs`?n.material=_:e===`near_limb`?n.material=g:a||(n.material=o?w:v),n.castShadow=a,n.receiveShadow=a&&e!==`hero_twigs`,n.name=e,i.add(n),W.push(t.geometry)}for(let[t,n]of Object.entries(r.tufts)){if(!n.length)continue;let r=fe(f.get(L[t]).geometry,o?E:x,n,a,!a);r.name=`${e}_${t}`,i.add(r),W.push(r)}R.add(i);let s=[];if(i.traverse(e=>e.isMesh&&s.push(e)),U.push({node:i,meshes:s,show:r.show,offRailX:ce[e],fade:1}),t(i),r.W){let e=new T(...r.W);H.push({node:i,meshes:s,W:e,D:r.D,keys:r.keys,world:a}),a||(i.rotation.y=de(e,r.show))}e===`hero`&&n.registry.set(`env_pines.heroNode`,i)}z=te(n,s.grass),R.add(z.mesh),B=await ne(n),R.add(B.mesh);let D=s.perches.map(e=>new T(e[0],e[1],e[2]));n.registry.set(`env_pines.perches`,D);let O=n.params.only;if(O?.length&&!O.some(e=>/plateau/.test(e))){let e=await A(()=>import(`./layout-BxJUyHwJ.js`).then(e=>e.a),__vite__mapDeps([0,1,2]),import.meta.url),{createReceiver:t}=await A(async()=>{let{createReceiver:e}=await import(`./review_receiver-DXl2AIau.js`);return{createReceiver:e}},__vite__mapDeps([3,4,1,5,6]),import.meta.url);V=t(e),R.add(V)}}function me(e,t){G.uWindT.value=t.time.t,z?.update(t.time.t)}function he(e){let t=e.camera.position,n=(e.registry.get(`camera_rig.rail`)?.u??e.time.t)*24;for(let e of U){let r=ie(n,e.show,K)*ae(t.x,e.offRailX);if(e.node.visible=r>0,r!==e.fade){e.fade=r;for(let t of e.meshes)t.userData.inkFade=r}}for(let r of H){if(!r.node.visible)continue;let i=Y.copy(r.W).sub(t).length(),a=Math.min(r.D/i,1);for(let e of r.meshes)e.userData.inkFog=a;let o=ue(r.keys,n);if(r.node.position.copy(r.W),r.node.scale.setScalar(o.s),r.world&&r.node.position.addScaledVector(r.W,-o.s),o.dx||o.dy){let t=i/le;r.node.position.x+=Math.cos(e.camera.rotation.y)*o.dx*t,r.node.position.z-=Math.sin(e.camera.rotation.y)*o.dx*t,r.node.position.y-=o.dy*t}}B?.beforeRender(e)}function ge(e){R&&e.scene.remove(R),z?.dispose(),B?.dispose(),V?.traverse(e=>{e.geometry?.dispose(),e.material?.dispose()});for(let e of W)e.dispose?.();W.length=H.length=U.length=0,e.registry.delete(`env_pines.perches`),e.registry.delete(`env_pines.heroNode`),R=z=B=V=null}export{he as beforeRender,F as budgetMs,P as chapter,ge as dispose,pe as init,oe as name,se as order,me as update};