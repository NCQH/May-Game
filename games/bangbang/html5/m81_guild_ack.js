/* Postconditions prevent unrelated guild broadcasts from completing a mutation.
 * All values are accepted native state; never apply optimistic account changes. */
export function guildMutationConfirmed(operation,values,before,after,selfUuid='') {
 const team=(a,id)=>a.teams?.find(t=>t.teamId===id);
 const members=a=>Object.values(a.members||{}).flat();
 switch(operation){
  case 'create':return after.guild?.name===values.name&&after.guild?.leaderUuid===selfUuid;
  case 'createTeam':return after.teams?.some(t=>t.name===values.name&&!before.teams?.some(b=>b.teamId===t.teamId));
  case 'rename':return after.guild?.name===values.name;
  case 'renameTeam':return team(after,values.teamId)?.name===values.name;
  case 'join':return after.guild?.guildId===values.guildId&&after.selfTeamId===values.teamId;
  case 'leave':return !after.guild;
  case 'research':return Number(after.research?.[values.skillId]||0)>Number(before.research?.[values.skillId]||0);
  case 'learn':return Number(after.learned?.[values.skillId]||0)>Number(before.learned?.[values.skillId]||0);
  case 'unlockSlot':return !!(after.slotFlags&(1<<values.slotId));
  case 'equipSkill':return values.skillId===0?!after.slots?.[values.slotId]:after.slots?.[values.slotId]?.skillId===values.skillId&&after.slots?.[values.slotId]?.level===Math.min(values.level,after.research?.[values.skillId]||0);
  case 'upgrade':return Number(after.guild?.level||0)>Number(before.guild?.level||0);
  case 'notice':return after.guild?.notice===values.text;
  case 'recruit':return after.guild?.recruitNotice===values.text;
  case 'setting':return after.guild?.[({1:'settings',2:'minLevel',3:'minLadder'})[values.kind]]===values.value;
  case 'remove':return !members(after).some(m=>m.charUuid===values.charUuid);
  case 'approve':return members(after).some(m=>m.charUuid===values.charUuid&&m.teamId===values.teamId);
  case 'reject':return !after.applications?.some(m=>m.charUuid===values.charUuid);
  case 'dissolveTeam':return !team(after,values.teamId);
  case 'move':return members(after).some(m=>m.charUuid===values.charUuid&&m.teamId===values.teamId)&&(!values.otherUuid||members(after).some(m=>m.charUuid===values.otherUuid&&m.teamId===values.originTeamId));
  case 'acceptTeam':return after.selfTeamId===values.teamId;
  case 'appoint':return values.post===10?after.guild?.leaderUuid===values.charUuid:values.post===9?after.guild?.viceLeaderUuid===values.charUuid:values.post===5?team(after,values.teamId)?.leaderUuid===values.charUuid:after.guild?.viceLeaderUuid!==values.charUuid&&team(after,values.teamId)?.leaderUuid!==values.charUuid;
  // Native invitation/refresh/application responses have no unique success ID.
  // These remain transport acknowledgements, not proof of recipient delivery.
  default:return true;
 }
}
