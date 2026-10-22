// Read-only companion for the opt-in mixed load test. Start after its first progress record.
import { writeFile } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import { createDb } from '@/server/db/client';
import { campaigns, dmJobs } from '@/server/db/schema';
import { getCampaignForecast } from '@/server/campaigns/forecast';
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,Math.max(0,ms)));
async function main(){
 const url = process.env.TEST_DATABASE_URL;
 if (process.env.GONGGU_RUNTIME_LOAD !== '1' || !url) throw new Error('Set GONGGU_RUNTIME_LOAD=1 and the dedicated TEST_DATABASE_URL');
 const output = process.env.GONGGU_FORECAST_OBSERVER_PREFIX;
 if (!output) throw new Error('Set GONGGU_FORECAST_OBSERVER_PREFIX for measurement files');
 const {db,sql:connection}=createDb(url,{max:2});
 try {
 const accounts=await db.select().from(campaigns).orderBy(campaigns.createdAt).limit(60); if(accounts.length!==60)throw new Error('Mixed-load fixture not ready');
 const openAt=accounts[0].openAt; await sleep(+openAt-Date.now()-15_000);
 const samples:{campaignId:string;asOf:string;waiting:number;predictedAt:string;nominalAt:string}[]=[];
 for(const a of accounts){
  const f=await getCampaignForecast(db,a.userId,a.igAccountId,a.id); if(f.waiting===12&&f.completionAt&&f.nominalCompletionAt)samples.push({campaignId:a.id,asOf:f.asOf,waiting:f.waiting,predictedAt:f.completionAt,nominalAt:f.nominalCompletionAt});if(samples.length===20)break;
 }
 if(samples.length<10)throw new Error('Not enough fully populated pre-open queues');
 await writeFile(`${output}-before.json`,JSON.stringify({openAt,samples},null,2));
 let completed:Record<string,string>={};
 while(Date.now()<+openAt+400_000){
  const results=await db.select({campaignId:dmJobs.campaignId,n:sql<number>`count(*)::int`,at:sql<string>`max(${dmJobs.completedAt})`}).from(dmJobs).where(sql`${inArray(dmJobs.campaignId,samples.map(s=>s.campaignId))} and ${dmJobs.channel}='private_reply' and ${dmJobs.status}='sent'`).groupBy(dmJobs.campaignId);
  completed=Object.fromEntries(results.filter(r=>r.n===12).map(r=>[r.campaignId,r.at]));if(samples.every(s=>completed[s.campaignId]))break;await sleep(1000);
 }
 const errors=samples.map(s=>{if(!completed[s.campaignId])throw new Error('Selected queues did not drain');return{...s,actualAt:new Date(completed[s.campaignId]).toISOString(),errorMs:+new Date(completed[s.campaignId])-+new Date(s.predictedAt)};});
 await writeFile(`${output}-result.json`,JSON.stringify({scenario:'pre-open-forecast-observation',openAt,sampleCount:errors.length,maxAbsoluteErrorMs:Math.max(...errors.map(s=>Math.abs(s.errorMs))),samples:errors,observerPoolMax:2,externalMetaCalls:0},null,2));console.log('Forecast comparison captured');
 } finally {await connection.end();}
}
main().catch(e=>{console.error(e.name,e.message);process.exitCode=1});
