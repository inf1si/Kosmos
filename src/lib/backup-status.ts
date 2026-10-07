export function backupHealth(report:{completedAt:string}|null,now=Date.now()){
  if(!report)return 'missing' as const;
  const age=now-Date.parse(report.completedAt);

  return !Number.isFinite(age)||age< -5*60*1000||age>36*60*60*1000?'overdue' as const:'recent' as const;
}
