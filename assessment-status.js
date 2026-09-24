// Labels describe observed answers only. Missing checks never become zeroes.
export function assessmentStatus(score, kind='knowledge') {
  if (!Number.isFinite(score) || score<0 || score>100) return {key:'unavailable',label:'Оцінку не отримано'};
  const labels=kind==='recommendation'
    ? ['Не рекомендує','Частково рекомендує','Рекомендує']
    : ['Не знає','Частково знає','Знає'];
  const index=score===0?0:score===100?2:1;
  return {key:['none','partial','full'][index],label:labels[index]};
}
