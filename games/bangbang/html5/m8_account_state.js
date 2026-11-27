// Only accepted native packets update this view. It contains no combat rules.
export function createAccountState() {
  return {revision:0,guild:null,teams:[],selfTeamId:0,members:{},buddies:{},research:{},
    learned:{},slots:{},slotFlags:0,limits:{},applications:[],inviters:[],invitation:null,teamInvitation:null};
}
function skillMap(old,packet) {
  const next=packet.opType?{}:{...old};
  for (const row of packet.skills) next[row.skillId]=row.level;
  return next;
}
export function applyAccountPacket(state,packet,{charUuid=''}={}) {
  let patch;
  switch(packet.type) {
    case 'guildInfo':
      patch={guild:{...packet.guild},teams:packet.teams.map(row=>({...row})),selfTeamId:packet.selfTeamId}; break;
    case 'guildMembers':
      if(state.guild && packet.guildId!==state.guild.guildId) return state;
      patch={members:{...state.members,[packet.teamId]:packet.members.map(row=>({...row}))}}; break;
    case 'guildBuddies':
      patch={buddies:Object.fromEntries(packet.buddies.map(row=>[row.accountId,{...row}]))}; break;
    case 'guildMemberLeft':
      if(packet.charUuid===charUuid) patch={guild:null,teams:[],selfTeamId:0,members:{},research:{},applications:[],inviters:[]};
      else patch={members:Object.fromEntries(Object.entries(state.members).map(([id,rows])=>[id,rows.filter(row=>row.charUuid!==packet.charUuid)]))};
      break;
    case 'guildResearch':patch={research:skillMap(state.research,packet)};break;
    case 'guildSkills':patch={learned:skillMap(state.learned,packet)};break;
    case 'guildSlots':patch={slots:Object.fromEntries(packet.slots.map(row=>[row.slotId,{...row}])),slotFlags:packet.flags};break;
    case 'limits':patch={limits:{...state.limits,...Object.fromEntries(packet.limits.map(row=>[row.limitId,row.count]))}};break;
    case 'guildApplications':patch={applications:packet.applicants.map(row=>({...row})),inviters:packet.inviters.map(row=>({...row}))};break;
    case 'guildInvitation':patch={invitation:{inviter:packet.inviter,guildId:packet.guildId,guildName:packet.guildName,teamId:packet.teamId,teamName:packet.teamName}};break;
    case 'guildTeamInvitation':patch={teamInvitation:{inviterUuid:packet.inviterUuid,charUuid:packet.charUuid,teamId:packet.teamId,teamName:packet.teamName}};break;
    default:return state;
  }
  return {...state,...patch,revision:state.revision+1};
}
export function ownGuildMember(state,accountId) {
  return Object.values(state.members).flat().find(row=>row.accountId===accountId)||null;
}
export function nativeMilitaryView(stars,catalog) {
  const totals={};let current=null,next=null;
  for(const row of catalog?.military||[]) {
    if(row.stars>stars) {next=row;break;}
    current=row;
    if(row.stars) for(const attr of row.attributes) {
      const key=`${attr.type}:${attr.valueType}`;
      totals[key]=(totals[key]||0)+Number(attr.value);
    }
  }
  return {stars,current,next,totals};
}
