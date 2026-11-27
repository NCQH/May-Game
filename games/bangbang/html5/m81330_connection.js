import {M81329Connection} from './m81329_connection.js';
import {encodeEnterWorldBoss,encodeOpenWorldBoss,encodeCloseWorldBoss,
  encodeWorldBossMeta,isWorldBossScene} from './m81330_protocol.js';
import {createWorldBossState,applyWorldBossPacket,worldBossView} from './m81330_state.js';

export class M81330Connection extends M81329Connection{
  emptyState(){return {...super.emptyState(),worldBoss:createWorldBossState()};}
  withOutside(snapshot){return {...super.withOutside(snapshot),
    worldBoss:this.cachedView('worldBoss',this.state.worldBoss,structuredClone)};}
  async connect(credentials=null,automatic=false){
    this.worldBossWatchGeneration=null;this.worldBossWatching=false;this.worldBossOwners=new Set();
    const expected=this.generation+1,ok=await super.connect(credentials,automatic);
    if(ok&&expected===this.generation&&this.state.phase==='ready'){
      // Explicit capability opt-in only after authenticated GATE sync. Flash
      // clients never receive S60003 and 1951/1952 retain their exact layouts.
      this.gate.send(encodeWorldBossMeta());
      this.syncWorldBossWatch();
    }
    return ok;
  }
  receive(packet,role,generation){
    if(generation!==this.generation)return;
    if(role==='GATE')this.state.worldBoss=applyWorldBossPacket(this.state.worldBoss,packet);
    super.receive(packet,role,generation);
    if(role==='GATE')this.syncWorldBossWatch();
  }
  watchWorldBoss(owner,enabled){
    if(!['panel','battle'].includes(owner))throw new RangeError('Chủ thể theo dõi boss không hợp lệ.');
    this.worldBossOwners??=new Set();
    if(enabled)this.worldBossOwners.add(owner);else this.worldBossOwners.delete(owner);
    this.syncWorldBossWatch();
  }
  syncWorldBossWatch(){
    if(this.state.phase!=='ready'||!this.gate)return;
    this.worldBossOwners??=new Set();
    if(isWorldBossScene(this.state.play.scene))this.worldBossOwners.add('battle');
    else this.worldBossOwners.delete('battle');
    if(this.worldBossWatchGeneration!==this.generation){
      this.worldBossWatchGeneration=this.generation;this.worldBossWatching=false;
    }
    const desired=this.worldBossOwners.size>0;
    if(desired===this.worldBossWatching)return;
    // Subscription does not grant entry or mutate combat/economy. A successful
    // send is not an HP/rank acknowledgement; UI waits for native data.
    this.gate.send(desired?encodeOpenWorldBoss():encodeCloseWorldBoss());
    this.worldBossWatching=desired;
  }
  enterWorldBoss(){
    if(!worldBossView(this.snapshot()).canEnter)
      throw new Error('Hãy chờ Boss Thế Giới đồng bộ và mở lượt đấu.');
    return this.action('worldBossEnter',['lobby'],gate=>this.pveRequest(gate,
      encodeEnterWorldBoss(),p=>p.type==='battleStart'&&isWorldBossScene(p),'vào Boss Thế Giới'));
  }
}
