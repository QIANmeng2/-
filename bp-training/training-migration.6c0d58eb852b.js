'use strict';
function updateTrainingMeetingCatalog(current,defaults){
  const result=JSON.parse(JSON.stringify(current));
  const replaced=new Set(['dragon-rewind','jungle-rewind','base-rewind','pickoff-rewind','five-minute','pov-class','rewind','kpl-replica','communication']);
  result.scenes=[...JSON.parse(JSON.stringify(defaults.scenes)),...result.scenes.filter(item=>!replaced.has(item.id))];
  return result;
}
function updateTrainingCourseCatalog(current){
  const result=JSON.parse(JSON.stringify(current));
  for(const item of result.scenes){
    if(item.id!=='communication'||item.format==='course'||item.format==='blocks')continue;
    const sections=item.sections||[];
    const opening=[];
    if(item.scene.trim())opening.push({title:'课程导入',text:item.scene});
    if(item.rules.length)opening.push({title:'课堂组织与表达方法',text:item.rules.join('\n\n')});
    const closing=item.acceptance.trim()?[{title:'课堂讨论与复盘',text:item.acceptance}]:[];
    item.sections=[...opening,...sections,...closing];
    item.scene='';item.rules=[];item.acceptance='';item.format='course';
  }
  return result;
}
function updateTrainingBlockCatalog(current){
  const result=updateTrainingCourseCatalog(current);
  for(const key of ['skills','basics','scenes'])for(const item of result[key]){
    if(item.format==='blocks')continue;
    if(item.format!=='course')item.sections=[
      {title:key==='scenes'?'场景':'准备',text:item.scene},
      {title:'规则',text:item.rules.join('\n')},
      {title:'验收',text:item.acceptance},
      ...(item.sections||[])
    ];
    item.scene='';item.rules=[];item.acceptance='';item.format='blocks';
  }
  return result;
}
if(typeof module!=='undefined'){module.exports=updateTrainingMeetingCatalog;module.exports.course=updateTrainingCourseCatalog;module.exports.blocks=updateTrainingBlockCatalog;}
