/** Run: node qa/core-regression.mjs [path/to/prototype.html]
 * Read-only Node VM regression suite. Does not execute DOM/UI or access real storage.
 * Baseline is the exact first inline script from the original 2026-11-03 prototype.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const BASELINE_SHA256 = '665449aef18a73a891a356c416888688aa4968b9ea01e0a1bb2dc1b28a53a586';
const path = process.argv[2] || fileURLToPath(new URL('../index.html', import.meta.url));
const html = readFileSync(path, 'utf8');
const core = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(core, 'First inline core script exists');
const hash = createHash('sha256').update(core).digest('hex');
const context = vm.createContext({});
vm.runInContext(core, context, { filename: 'SailCore.js', timeout: 2000 });
const { Game, PORTS, ROCKS } = context.SailCore;
const plain = value => JSON.parse(JSON.stringify(value));
const snapshot = game => JSON.stringify(game.s);
const cargo = (g, helper=false) => g.orders(helper ? g.s.helper.port : g.s.ship.port, helper).find(o => o.type === 'cargo');
const accept = (g, helper=false) => { const o=cargo(g,helper); assert.ok(o); const r=g.accept(o.id,helper); assert.equal(r.ok,true); return r.order; };
const steps = (g,n,input={}) => { for(let i=0;i<n;i++)g.step(.05,input); };
let passed=0,failed=0;
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); passed++; } catch(e) { console.error(`FAIL ${name}\n${e.stack}`); failed++; } }
function unchanged(g,fn){const before=snapshot(g);fn();assert.equal(snapshot(g),before);}
// Independently captured v1 shape: intentionally no UI/camera fields.
const LEGACY_V1={version:1,rev:1,seq:0,money:40,ports:[{stock:[20,35,80],incoming:[0,0,0]},{stock:[25,80,20],incoming:[0,0,0]},{stock:[75,20,35],incoming:[0,0,0]},{stock:[75,25,25],incoming:[0,0,0]}],ship:{x:180,y:190,angle:0,speed:0,port:0,order:null,dock:0,load:0,activeSeconds:0,safe:{x:180,y:190},cooldown:0},helper:null,upgrades:{sail:0,rudder:0},turnover:0,settled:[],history:[],stable:[],visited:[],deliveries:0,helperDeliveries:0,clock:0,settings:{sound:false,calm:false},lastReceipt:null};

test('Exact original economic/physics core preserved',()=>assert.equal(hash,BASELINE_SHA256));
test('Fresh state and legacy v1 save load without migration',()=>{const g=new Game(LEGACY_V1);assert.deepEqual(plain(g.s),LEGACY_V1);assert.deepEqual(plain(new Game().s),LEGACY_V1);g.s.money++;assert.equal(LEGACY_V1.money,40);});
test('Accept locks price, debits source stock and reserves destination once',()=>{const g=new Game(),offer=cargo(g),before=plain(g.s);const o=accept(g);assert.equal(g.s.money,40);assert.equal(g.s.ports[o.from].stock[o.good],before.ports[o.from].stock[o.good]-o.q);assert.equal(g.s.ports[o.to].incoming[o.good],o.q);assert.equal(o.net,offer.net);unchanged(g,()=>assert.equal(g.accept(offer.id).ok,false));g.cycle();assert.equal(o.net,offer.net);assert.equal(o.gross,offer.gross);assert.equal(g.validate(),true);});
test('Stale quote, unknown quote and absent helper reject without mutation',()=>{const g=new Game(),id=cargo(g).id;g.s.rev++;unchanged(g,()=>assert.equal(g.accept(id).ok,false));unchanged(g,()=>assert.equal(g.accept('bad').ok,false));unchanged(g,()=>assert.equal(g.accept(id,true).ok,false));});
test('Underway or moving ships cannot accept orders',()=>{for(const mutate of [g=>g.s.ship.port=null,g=>g.s.ship.speed=2]){const g=new Game(),id=cargo(g).id;mutate(g);unchanged(g,()=>assert.equal(g.accept(id).ok,false));}});
test('Supply floor and saturated demand suppress cargo but preserve mail',()=>{for(const mode of ['supply','demand']){const g=new Game();if(mode==='supply')g.s.ports[0].stock[2]=19;else for(let p=1;p<4;p++)g.s.ports[p].stock[2]=50;assert.equal(g.orders().filter(o=>o.type==='cargo').length,0);assert.equal(g.orders().at(-1).type,'mail');}assert.equal(new Game().orders(null).length,0);});
test('Cancel restores reservation and stock, gives no reward, is idempotent',()=>{const g=new Game(),stocks=plain(g.s.ports);accept(g);assert.equal(g.cancel(),true);assert.deepEqual(plain(g.s.ports),stocks);assert.equal(g.s.money,40);assert.equal(g.s.deliveries,0);assert.equal(g.s.turnover,0);unchanged(g,()=>assert.equal(g.cancel(),false));assert.equal(g.validate(),true);});
test('Cancel at sea rejected and production cannot overflow returned cargo',()=>{const g=new Game();const o=accept(g);g.s.ship.port=null;unchanged(g,()=>assert.equal(g.cancel(),false));g.s.ship.port=o.from;for(let i=0;i<20;i++)g.cycle();assert.equal(g.cancel(),true);assert.ok(g.s.ports[o.from].stock[o.good]<=100);g.validate();});
test('Settlement pays locked amount, releases stock and cycles exactly once',()=>{const g=new Game(),o=accept(g),destBefore=g.s.ports[o.to].stock[o.good];const receipt=g.settle(g.s.ship);assert.equal(receipt.net,o.net);assert.equal(g.s.money,40+o.net);assert.equal(receipt.before,destBefore);assert.equal(receipt.afterDelivery,destBefore+10);assert.equal(receipt.after,destBefore+8);assert.equal(g.s.ports[o.to].incoming[o.good],0);assert.equal(g.s.turnover,0);assert.equal(g.s.deliveries,1);assert.equal(g.s.history.length,1);unchanged(g,()=>assert.equal(g.settle(g.s.ship),false));const duplicate={...g.s.ship,order:o};unchanged(g,()=>assert.equal(g.settle(duplicate),false));g.validate();});
test('Mail pays flat income with no inventory or economic-cycle side effects',()=>{const g=new Game(),ports=plain(g.s.ports),o=g.orders().find(o=>o.type==='mail');assert.equal(g.accept(o.id).ok,true);const r=g.settle(g.s.ship);assert.equal(r.net,12);assert.equal(g.s.money,52);assert.equal(g.s.turnover,0);assert.deepEqual(plain(g.s.ports),ports);g.validate();});
test('Purchases charge once, enforce funds and docking, reject unknown kinds',()=>{const g=new Game();unchanged(g,()=>assert.equal(g.buy('sail').ok,false));g.s.money=1000;for(const [kind,price] of [['sail',60],['rudder',60],['helper',280]]){const before=g.s.money;assert.equal(g.buy(kind).ok,true);assert.equal(g.s.money,before-price);unchanged(g,()=>assert.equal(g.buy(kind).ok,false));}assert.ok(Math.abs(g.maxSpeed()-29.92)<1e-9);unchanged(g,()=>assert.equal(g.buy('invalid').ok,false));g.validate();const sea=new Game();sea.s.money=1000;sea.s.ship.port=null;unchanged(sea,()=>assert.equal(sea.buy('helper').ok,false));});
test('Helper carries five, pays wage, survives reload and settles only once',()=>{let g=new Game();g.s.money=1000;g.buy('helper');const o=accept(g,true);assert.equal(o.q,5);assert.equal(o.wage,4);assert.equal(o.bonus,0);steps(g,200);g=new Game(plain(g.s));assert.ok(g.s.helper.progress>0);steps(g,800);assert.equal(g.s.helperDeliveries,1);assert.equal(g.s.money,720+o.net);assert.equal(g.s.turnover,5);assert.equal(g.s.helper.order,null);const after=g.s.money;steps(g,1000);assert.equal(g.s.money,after);g.validate();});
test('Concurrent flagship and helper reservations remain balanced',()=>{const g=new Game();g.s.money=1000;g.buy('helper');const main=accept(g),helper=accept(g,true);assert.notEqual(main.uid,helper.uid);g.validate();g.settle(g.s.ship);g.validate();g.settle(g.s.helper,true);g.validate();assert.equal(g.s.deliveries,1);assert.equal(g.s.helperDeliveries,1);assert.equal(g.s.turnover,5);});
test('Rock collisions slow ship, cap damage at three, apply cooldown and preserve fee',()=>{const g=new Game(),o=accept(g),sh=g.s.ship;sh.load=0;const collide=()=>{sh.x=ROCKS[0].x;sh.y=ROCKS[0].y;sh.speed=20;g.step(.05);};collide();assert.equal(o.damage,1);assert.ok(sh.speed<6);collide();assert.equal(o.damage,1);for(let i=0;i<5;i++){sh.cooldown=0;collide();}assert.equal(o.damage,3);const r=g.settle(sh);assert.equal(r.gross,o.gross);assert.equal(r.bonus,0);assert.equal(r.net,o.base);g.validate();});
test('Boundary collision clamps position and rescue retains order, damage and price',()=>{const g=new Game(),o=accept(g),sh=g.s.ship;sh.load=0;sh.x=74;sh.y=99;g.step(.05);assert.ok(sh.x>=75&&sh.y>=100);const locked=plain(o);sh.safe={x:180,y:190};g.resetSafe();assert.equal(sh.x,180);assert.equal(sh.y,190);assert.equal(sh.speed,0);assert.deepEqual(plain(sh.order),locked);g.validate();});
test('Loading blocks movement and large/negative dt cannot skip gameplay',()=>{const g=new Game();accept(g);const pos=[g.s.ship.x,g.s.ship.y];g.step(100,{throttle:true});assert.equal(g.s.clock,.05);assert.deepEqual([g.s.ship.x,g.s.ship.y],pos);g.step(-1,{throttle:true});assert.equal(g.s.clock,.05);});
test('Automatic docking requires sustained arrival, then produces one receipt',()=>{const g=new Game(),o=accept(g),sh=g.s.ship;sh.load=0;sh.x=PORTS[o.to].x;sh.y=PORTS[o.to].y;sh.speed=0;steps(g,10);assert.equal(g.s.deliveries,0);sh.x=500;sh.y=500;g.step(.05);assert.equal(sh.dock,0);sh.x=PORTS[o.to].x;sh.y=PORTS[o.to].y;steps(g,40);assert.equal(g.s.deliveries,1);steps(g,40);assert.equal(g.s.deliveries,1);g.validate();});
test('JSON save/reload preserves upgrades, settings, fleet and exact future simulation',()=>{const g=new Game();g.s.money=1000;g.buy('helper');g.buy('rudder');g.buy('sail');g.s.settings.sound=true;g.s.settings.calm=true;accept(g);accept(g,true);steps(g,100,{throttle:true,steer:.3});const restored=new Game(JSON.parse(snapshot(g)));assert.equal(snapshot(restored),snapshot(g));for(let i=0;i<100;i++){g.step(.05,{brake:true});restored.step(.05,{brake:true});}assert.equal(snapshot(restored),snapshot(g));g.validate();restored.validate();});
test('Completed-save reload cannot duplicate previous income',()=>{const g=new Game();accept(g);g.settle(g.s.ship);const restored=new Game(plain(g.s));unchanged(restored,()=>assert.equal(restored.settle(restored.s.ship),false));assert.equal(restored.s.history.length,1);});
for(const [name,mutate] of Object.entries({
 'unsupported version':s=>s.version=0,'negative money':s=>s.money=-1,'fractional money':s=>s.money=.5,'missing ports':s=>s.ports=[], 'invalid upgrade':s=>s.upgrades.sail=2,'invalid turnover':s=>s.turnover=10,'invalid ship port':s=>s.ship.port=5,'negative stock':s=>s.ports[0].stock[0]=-1,'capacity overflow':s=>s.ports[0].stock[0]=101,'orphan reservation':s=>s.ports[0].incoming[0]=1,'duplicate settlement':s=>{s.seq=1;s.settled=[1,1];},'nonfinite coordinate':s=>s.ship.x=Infinity
}))test(`Corrupt save rejected: ${name}`,()=>{const s=plain(LEGACY_V1);mutate(s);assert.throws(()=>new Game(s));});
for(const [name,mutate] of Object.entries({
 'locked arithmetic':s=>s.ship.order.base++,'negative damage':s=>s.ship.order.damage=-1,'wrong cargo quantity':s=>s.ship.order.q=999,'same destination':s=>s.ship.order.to=s.ship.order.from,'settled active UID':s=>s.settled.push(s.ship.order.uid),'missing reservation':s=>s.ports[s.ship.order.to].incoming[s.ship.order.good]=0
}))test(`Corrupt in-flight save rejected: ${name}`,()=>{const g=new Game();accept(g);const s=plain(g.s);mutate(s);assert.throws(()=>new Game(s));});
console.log(`\nCore SHA-256: ${hash}\n${passed} passed; ${failed} failed.`);
process.exitCode=failed?1:0;
