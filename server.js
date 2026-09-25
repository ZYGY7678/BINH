
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const DEFAULT_OWNER = process.env.GITHUB_OWNER || "ZYGY7678";
const DEFAULT_REPO = process.env.GITHUB_REPO || "BINH";
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const jobs = new Map();

function send(res, code, body, headers={}) {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, {"content-length":b.length, ...headers});
  res.end(b);
}
function json(res, code, data) {
  send(res, code, JSON.stringify(data), {"content-type":"application/json; charset=utf-8"});
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let s="";
    req.setEncoding("utf8");
    req.on("data", c=>{ s+=c; if(s.length>1500000) reject(new Error("Request too large")); });
    req.on("end",()=>{ try{resolve(s?JSON.parse(s):{})}catch{reject(new Error("Invalid JSON"))} });
    req.on("error",reject);
  });
}
const wait = ms => new Promise(r=>setTimeout(r,ms));

async function github(token, endpoint, options={}) {
  if(!token) throw new Error("חסר GitHub Token");
  let lastError;
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),45000);
    try{
      const r=await fetch("https://api.github.com"+endpoint,{
        ...options,
        signal:controller.signal,
        headers:{
          "accept":"application/vnd.github+json",
          "authorization":"Bearer "+token,
          "x-github-api-version":"2022-11-28",
          "user-agent":"AI-App-Builder/1.0",
          ...(options.headers||{})
        }
      });
      const t=await r.text();
      let d={};
      try{d=t?JSON.parse(t):{}}catch{d={raw:t}};
      if(r.ok){clearTimeout(timer);return d;}
      lastError=new Error(d.message||("GitHub HTTP "+r.status));
      const retryable=r.status===429||r.status>=500;
      clearTimeout(timer);
      if(!retryable||attempt===2) throw lastError;
      const retryAfter=Number(r.headers.get("retry-after")||0);
      await wait(retryAfter>0?retryAfter*1000:Math.min(3000,500*(attempt+1)));
    }catch(e){
      clearTimeout(timer);
      lastError=e;
      if(attempt===2) throw e;
      await wait(Math.min(3000,500*(attempt+1)));
    }
  }
  throw lastError||new Error("GitHub request failed");
}

async function askGemini(key, userPrompt) {
  if(process.env.E2E_SMOKE_ENABLED==="1" && key==="E2E_TEST") {
    return {appName:"E2E Test App",packageName:"com.zygy.e2etest",summary:"Deterministic end-to-end test app.",files:[{path:"app/src/main/java/MainActivity.kt",content:`package com.zygy.e2etest\n\nimport android.os.Bundle\nimport androidx.activity.ComponentActivity\nimport androidx.activity.compose.setContent\nimport androidx.compose.material3.MaterialTheme\nimport androidx.compose.material3.Surface\nimport androidx.compose.material3.Text\n\nclass MainActivity : ComponentActivity() {\n  override fun onCreate(state: Bundle?) { super.onCreate(state); setContent { MaterialTheme { Surface { Text("E2E test OK") } } } }\n}\n`}]};
  }
  if(!key) throw new Error("חסר Gemini API Key");
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(MODEL)+":generateContent?key="+encodeURIComponent(key);
  const system=[
    "Generate Android apps in Kotlin with Jetpack Compose.",
    "Return JSON only.",
    "Schema: {appName,packageName,summary,files:[{path,content}]}",
    "Allowed files are Kotlin files under app/src/main/java/ and optional XML files under app/src/main/res/values/.",
    "MainActivity.kt is required.",
    "Never output Gradle files, manifests, wrapper files, binaries, shell scripts, secrets or network credentials.",
    "Keep the app useful, polished and functional.",
    "Do not generate malware, credential theft, destructive behavior or security bypasses."
  ].join(" ");
  const payload={
    system_instruction:{parts:[{text:system}]},
    contents:[{role:"user",parts:[{text:"Build this app:\\n\\n"+userPrompt}]}],
    generationConfig:{temperature:0.2,responseMimeType:"application/json"}
  };
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const t=await r.text();
  if(!r.ok){
    let msg="Gemini HTTP "+r.status;
    try{const ed=JSON.parse(t);if(ed?.error?.message)msg+=": "+ed.error.message;}catch{}
    throw new Error(msg);
  }
  const d=JSON.parse(t);
  const raw=d?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"";
  if(!raw) throw new Error("Gemini did not return a result");
  try{return JSON.parse(raw)}catch{throw new Error("Gemini returned invalid JSON")}
}
function cleanPackage(v){
  const raw=String(v||"com.example.aiapp").toLowerCase().replace(/[^a-z0-9_.]/g,".");
  const bits=raw.split(".").filter(Boolean).map(x=>/^[a-z_]/.test(x)?x:"app"+x);
  return bits.join(".")||"com.example.aiapp";
}
function safeName(v){ return String(v||"AI App").replace(/[<>]/g,"").trim().slice(0,50)||"AI App"; }
function escXml(v){
  return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
}
function fixedFiles(id,name,pkg){
  const root="builds/"+id+"/";
  const pp=pkg.replaceAll(".","/");
  return [
    {path:root+"settings.gradle.kts",content:"import org.gradle.api.initialization.resolve.RepositoriesMode\npluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }\ndependencyResolutionManagement { repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS); repositories { google(); mavenCentral() } }\nrootProject.name=\"AIApp\"\ninclude(\":app\")\n"},
    {path:root+"build.gradle.kts",content:"plugins { id(\"com.android.application\") version \"8.7.3\" apply false; id(\"org.jetbrains.kotlin.android\") version \"2.0.21\" apply false; id(\"org.jetbrains.kotlin.plugin.compose\") version \"2.0.21\" apply false }\n"},
    {path:root+"gradle.properties",content:"org.gradle.jvmargs=-Xmx2g -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nkotlin.code.style=official\n"},
    {path:root+"app/build.gradle.kts",content:"plugins { id(\"com.android.application\"); id(\"org.jetbrains.kotlin.android\"); id(\"org.jetbrains.kotlin.plugin.compose\") }\nandroid { namespace=\""+pkg+"\"; compileSdk=35; defaultConfig { applicationId=\""+pkg+"\"; minSdk=26; targetSdk=35; versionCode=1; versionName=\"1.0\" }; buildTypes { release { isMinifyEnabled=false } }; compileOptions { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }; kotlinOptions { jvmTarget=\"17\" }; buildFeatures { compose=true } }\ndependencies { implementation(platform(\"androidx.compose:compose-bom:2024.10.01\")); implementation(\"androidx.core:core-ktx:1.15.0\"); implementation(\"androidx.activity:activity-compose:1.9.3\"); implementation(\"androidx.compose.ui:ui\"); implementation(\"androidx.compose.ui:ui-tooling-preview\"); implementation(\"androidx.compose.material3:material3:1.3.1\"); implementation(\"androidx.navigation:navigation-compose:2.8.3\"); debugImplementation(\"androidx.compose.ui:ui-tooling\") }\n"},
    {path:root+"app/proguard-rules.pro",content:"# generated by AI App Builder\n"},
    {path:root+"app/src/main/res/values/strings.xml",content:"<?xml version=\"1.0\" encoding=\"utf-8\"?><resources><string name=\"app_name\">"+escXml(name)+"</string></resources>\n"},
    {path:root+"app/src/main/res/values/themes.xml",content:"<?xml version=\"1.0\" encoding=\"utf-8\"?><resources><style name=\"Theme.AIApp\" parent=\"android:style/Theme.Material.Light.NoActionBar\"><item name=\"android:fontFamily\">sans</item><item name=\"android:colorAccent\">#7C5CFC</item></style></resources>\n"},
    {path:root+"app/src/main/AndroidManifest.xml",content:"<?xml version=\"1.0\" encoding=\"utf-8\"?><manifest xmlns:android=\"http://schemas.android.com/apk/res/android\"><application android:allowBackup=\"true\" android:label=\"@string/app_name\" android:supportsRtl=\"true\" android:theme=\"@style/Theme.AIApp\"><activity android:name=\".MainActivity\" android:exported=\"true\"><intent-filter><action android:name=\"android.intent.action.MAIN\"/><category android:name=\"android.intent.category.LAUNCHER\"/></intent-filter></activity></application></manifest>\n"},
    {path:root+"app/src/main/java/"+pp+"/MainActivity.kt",content:"package "+pkg+"\n\nimport android.os.Bundle\nimport androidx.activity.ComponentActivity\nimport androidx.activity.compose.setContent\nimport androidx.compose.material3.*\nimport androidx.compose.runtime.Composable\n\nclass MainActivity: ComponentActivity(){ override fun onCreate(state: Bundle?){ super.onCreate(state); setContent{ App() } } }\n@Composable fun App(){ MaterialTheme{ Surface{ Text(\"Generated by AI App Builder\") } } }\n"}
  ];
}
function sanitizeFiles(id,spec,pkg){
  if(!Array.isArray(spec?.files) || spec.files.length<1 || spec.files.length>20) throw new Error("ה-AI החזיר מבנה קבצים לא תקין");
  const root="builds/"+id+"/"; const seen=new Set(); const out=[];
  for(const f of spec.files){
    if(!f||typeof f.path!=="string"||typeof f.content!=="string") continue;
    let q=f.path.replaceAll("\\\\","/").replace(/^\/+/,"");
    if(q.includes("..")||q.includes("//")) continue;
    if(q.startsWith("app/src/main/java/") && q.endsWith("/MainActivity.kt")) q="app/src/main/java/"+pkg.replaceAll(".","/")+"/MainActivity.kt";
    const allowed=(q.startsWith("app/src/main/java/")||q.startsWith("app/src/main/res/values/")||q==="app/src/main/AndroidManifest.xml")&&(q.endsWith(".kt")||q.endsWith(".xml"));
    if(!allowed||seen.has(q)||f.content.length>120000) continue;
    let c=f.content;
    if(q.endsWith(".kt")){
      c=/^package\s+[^\n]+/m.test(c)?c.replace(/^package\s+[^\n]+/m,"package "+pkg):"package "+pkg+"\n\n"+c;
    }
    out.push({path:root+q,content:c}); seen.add(q);
  }
  if(!out.some(x=>x.path.endsWith("/MainActivity.kt"))) throw new Error("MainActivity.kt חסר");
  return out;
}
async function putFile(token,owner,repo,file,branch){
  const endpoint="/repos/"+owner+"/"+repo+"/contents/"+encodeURI(file.path);
  let sha;
  try{
    const existing=await github(token,endpoint+"?ref="+encodeURIComponent(branch));
    sha=existing?.sha;
  }catch(e){
    if(!String(e.message||"").includes("Not Found")) throw e;
  }
  const body={message:"AI App Builder: "+file.path,content:Buffer.from(file.content).toString("base64"),branch};
  if(sha) body.sha=sha;
  await github(token,endpoint,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}
async function createBranch(token,owner,repo,branch){
  const ref=await github(token,"/repos/"+owner+"/"+repo+"/git/ref/heads/main");
  await github(token,"/repos/"+owner+"/"+repo+"/git/refs",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({ref:"refs/heads/"+branch,sha:ref.object.sha})
  });
}
async function triggerBuild(token,owner,repo,branch,id,job){
  job.triggeredAt=Date.now();
  if(process.env.E2E_SMOKE_ENABLED==="1"){
    await github(token,"/repos/"+owner+"/"+repo+"/actions/workflows/build-apk.yml/dispatches",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ref:branch,inputs:{project_id:id}})});
    return;
  }
  const marker={path:".build-trigger",content:JSON.stringify({project_id:id,triggered_at:job.triggeredAt})};
  await putFile(token,owner,repo,marker,branch);
}
async function latestRun(token,owner,repo,branch,afterRunId=null,sinceMs=0){
  const endpoint="/repos/"+owner+"/"+repo+"/actions/workflows/build-apk.yml/runs?branch="+encodeURIComponent(branch)+"&per_page=50";
  const d=await github(token,endpoint);
  const event=process.env.E2E_SMOKE_ENABLED==="1"?"workflow_dispatch":"push";
  return (d.workflow_runs||[])
    .filter(x=>x.event===event)
    .filter(x=>!afterRunId||x.id!==afterRunId)
    .filter(x=>!sinceMs || new Date(x.created_at).getTime()>=sinceMs)
    .sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
async function failureLogs(token,owner,repo,runId){
  try{
    const d=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs/"+runId+"/jobs?per_page=20");
    const j=(d.jobs||[]).find(x=>x.conclusion==="failure")||d.jobs?.[0];
    if(!j)return "";
    const r=await fetch("https://api.github.com/repos/"+owner+"/"+repo+"/actions/jobs/"+j.id+"/logs",{
      headers:{"accept":"application/vnd.github+json","authorization":"Bearer "+token,"x-github-api-version":"2022-11-28","user-agent":"AI-App-Builder/1.0"}
    });
    return (await r.text()).slice(-16000);
  }catch{return ""}
}

async function askGeminiFix(key, userPrompt, files, logs) {
  if(!key) throw new Error("חסר Gemini API Key");
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(MODEL)+":generateContent?key="+encodeURIComponent(key);
  const system=[
    "You are an Android build-fix agent.",
    "Return JSON only with schema {files:[{path,content}],explanation}.",
    "Fix only files under builds/PROJECT_ID/app/src/main/java/, builds/PROJECT_ID/app/src/main/res/values/, builds/PROJECT_ID/app/src/main/AndroidManifest.xml, or builds/PROJECT_ID/app/build.gradle.kts.",
    "Do not change root Gradle settings, Gradle wrapper, workflow files, or add arbitrary repositories. The app/build.gradle.kts file may be changed only to add or adjust standard AndroidX/Jetpack/Compose dependencies needed to fix the reported error.",
    "Preserve the requested app behavior and UI.",
    "Use Kotlin/Jetpack Compose APIs compatible with the existing project.",
    "Return complete replacement contents for every file you change.",
    "Never return secrets, malware, credential theft or destructive behavior."
  ].join(" ");
  const context=files.map(f=>f.path+"\n---\n"+f.content).join("\n====\n");
  const payload={
    system_instruction:{parts:[{text:system}]},
    contents:[{role:"user",parts:[{text:"PROJECT FILES:\n"+context+"\n\nGRADLE BUILD ERROR:\n"+logs.slice(-18000)+"\n\nOriginal app request:\n"+(userPrompt||"Preserve the current app behavior visible in the project files.")+"\n\nFix the build failure. Return only changed files from the allowed paths."}]}],
    generationConfig:{temperature:0.05,responseMimeType:"application/json"}
  };
  const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
  const t=await r.text();
  if(!r.ok){
    let msg="Gemini fix HTTP "+r.status;
    try{const ed=JSON.parse(t);if(ed?.error?.message)msg+=": "+ed.error.message;}catch{}
    throw new Error(msg);
  }
  const d=JSON.parse(t);
  const raw=d?.candidates?.[0]?.content?.parts?.map(x=>x.text||"").join("")||"";
  try{return JSON.parse(raw)}catch{throw new Error("Gemini fix returned invalid JSON")}
}
async function applyFix(token,owner,repo,branch,id,job,key,logs){
  const current=job.files.filter(f=>
    f.path.startsWith("builds/"+id+"/app/src/main/") ||
    f.path==="builds/"+id+"/app/build.gradle.kts"
  );
  const fix=await askGeminiFix(key,job.prompt,current,logs);
  if(!Array.isArray(fix.files)||!fix.files.length) throw new Error("AI did not produce a fix");
  const allowedRoot="builds/"+id+"/app/src/main/";
  const changed=[];
  for(const f of fix.files){
    if(!f||typeof f.path!=="string"||typeof f.content!=="string") continue;
    const q=f.path.replaceAll("\\\\","/").replace(/^\/+/,"");
    const allowed=(q.startsWith(allowedRoot+"java/")||q.startsWith(allowedRoot+"res/values/")||q===allowedRoot+"AndroidManifest.xml"||q==="builds/"+id+"/app/build.gradle.kts")&&(q.endsWith(".kt")||q.endsWith(".xml")||q.endsWith(".kts"))&&!q.includes("..");
    if(!allowed||f.content.length>120000) continue;
    const normalized=q.endsWith(".kt")
      ? (job.packageName
          ? (/^package\s+[^\n]+/m.test(f.content)
              ? f.content.replace(/^package\s+[^\n]+/m,"package "+job.packageName)
              : "package "+job.packageName+"\n\n"+f.content)
          : f.content)
      : f.content;
    const existing=job.files.find(x=>x.path===q);
    if(existing) existing.content=normalized; else job.files.push({path:q,content:normalized});
    await putFile(token,owner,repo,{path:q,content:normalized},branch);
    changed.push(q);
  }
  if(!changed.length) throw new Error("AI fix contained no allowed files");
  job.lastFix=fix.explanation||"AI applied a source-level build fix";
  job.fixFiles=changed;
}

async function buildAndWait(token,owner,repo,branch,id,job,geminiKey,previousRunId=null){
  let run=null;
  for(let i=0;i<30&&!run;i++){ run=await latestRun(token,owner,repo,branch,previousRunId,Math.max(0,(job.triggeredAt||Date.now())-15000)); if(!run) await wait(2000); }
  if(!run) throw new Error("GitHub Actions לא מצא את ההרצה");
  job.runId=run.id; job.runUrl=run.html_url;
  for(let i=0;i<90;i++){
    const x=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs/"+run.id);
    if(x.status==="completed"){
      if(x.conclusion!=="success"){
        job.logs=await failureLogs(token,owner,repo,run.id);
        if((job.fixAttempts||0)<3 && geminiKey){
          job.fixAttempts=(job.fixAttempts||0)+1;
          job.status="fixing"; job.stage="AI מנתח את שגיאת Gradle — תיקון "+job.fixAttempts+"/3";
          await applyFix(token,owner,repo,branch,id,job,geminiKey,job.logs);
          const previousRunId=run.id;
          await triggerBuild(token,owner,repo,branch,id,job);
          return await buildAndWait(token,owner,repo,branch,id,job,geminiKey,previousRunId);
        }
        throw new Error("הקומפילציה נכשלה אחרי "+(job.fixAttempts||0)+" ניסיונות תיקון");
      }
      const a=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs/"+run.id+"/artifacts");
      const z=(a.artifacts||[]).find(v=>v.name==="apk-"+id&&!v.expired);
      if(!z) throw new Error("APK artifact לא נמצא");
      job.artifactId=z.id; job.status="ready"; job.stage="APK מוכן להורדה"; return;
    }
    job.status="building"; job.stage=(job.fixAttempts||0)>0?"Gradle מקמפל אחרי תיקון "+job.fixAttempts+"/3":"Gradle מקמפל את ה־APK"; await wait(4000);
  }
  throw new Error("זמן הקומפילציה המקסימלי עבר");
}
async function startJob(job,creds){
  try{
    job.status="generating"; job.stage="AI מתכנן וכותב את האפליקציה";
    const repo=await github(creds.githubToken,"/repos/"+job.owner+"/"+job.repo);
    if(repo.archived) throw new Error("המאגר ב-GitHub בארכיון");
    if(repo?.permissions && !repo.permissions.push && process.env.E2E_SMOKE_ENABLED!=="1") throw new Error("ל-GitHub Token אין הרשאת כתיבה (push) למאגר");
    await github(creds.githubToken,"/repos/"+job.owner+"/"+job.repo+"/contents/.github/workflows/build-apk.yml?ref=main");
    const spec=await askGemini(creds.geminiKey,job.prompt);
    const pkg=cleanPackage(spec.packageName), name=safeName(spec.appName);
    const map=new Map(fixedFiles(job.id,name,pkg).map(x=>[x.path,x]));
    for(const f of sanitizeFiles(job.id,spec,pkg)) map.set(f.path,f);
    job.appName=name; job.packageName=pkg; job.summary=spec.summary||"";
    job.status="uploading"; job.stage="מעלה את הפרויקט ל־GitHub";
    const branch="builder/"+job.id; job.branch=branch; job.files=[...map.values()];
    job.githubToken=creds.githubToken;
    await createBranch(creds.githubToken,job.owner,job.repo,branch);
    for(const f of job.files) await putFile(creds.githubToken,job.owner,job.repo,f,branch);
    job.status="building"; job.stage="מפעיל קומפילציה ב־GitHub Actions";
    await triggerBuild(creds.githubToken,job.owner,job.repo,branch,job.id,job);
    await buildAndWait(creds.githubToken,job.owner,job.repo,branch,job.id,job,creds.geminiKey);
  }catch(e){
    job.status="failed";
    job.error=e.message;
    job.stage="נכשל: "+e.message;
  }
}
async function route(req,res){
  const u=new URL(req.url,"http://localhost");
  if(req.method==="GET"&&u.pathname==="/api/health") return json(res,200,{ok:true,model:MODEL,repo:DEFAULT_OWNER+"/"+DEFAULT_REPO});
  if(req.method==="POST"&&u.pathname==="/api/validate"){
    try{
      const b=await readBody(req), owner=b.owner||DEFAULT_OWNER, repo=b.repo||DEFAULT_REPO;
      const me=await github(b.githubToken,"/user"); const r=await github(b.githubToken,"/repos/"+owner+"/"+repo);
      return json(res,200,{ok:true,githubUser:me.login,repo:r.full_name,private:r.private,model:MODEL});
    }catch(e){return json(res,400,{ok:false,error:e.message})}
  }
  if(req.method==="POST"&&u.pathname==="/api/build"){
    try{
      const b=await readBody(req), prompt=String(b.prompt||"").trim();
      if(prompt.length<5) throw new Error("כתוב פקודה מפורטת יותר");
      const id=crypto.randomUUID().slice(0,8);
      const job={id,prompt,owner:b.owner||DEFAULT_OWNER,repo:b.repo||DEFAULT_REPO,status:"queued",stage:"מתכונן",createdAt:Date.now()};
      jobs.set(id,job);
      void startJob(job,{githubToken:String(b.githubToken||""),geminiKey:String(b.geminiKey||"")});
      return json(res,202,{ok:true,jobId:id});
    }catch(e){return json(res,400,{error:e.message})}
  }
  const m=u.pathname.match(/^\/api\/build\/([a-z0-9-]+)$/i);
  if(req.method==="GET"&&m){
    const j=jobs.get(m[1]); if(!j)return json(res,404,{error:"Build not found"});
    const {files,githubToken,...safe}=j; return json(res,200,safe);
  }
  const d=u.pathname.match(/^\/api\/build\/([a-z0-9-]+)\/download$/i);
  if(req.method==="GET"&&d){
    const j=jobs.get(d[1]); if(!j||j.status!=="ready")return json(res,404,{error:"APK not ready"});
    try{
      const r=await fetch("https://api.github.com/repos/"+j.owner+"/"+j.repo+"/actions/artifacts/"+j.artifactId+"/zip",{
        headers:{"accept":"application/vnd.github+json","authorization":"Bearer "+j.githubToken,"x-github-api-version":"2022-11-28","user-agent":"AI-App-Builder/1.0"}
      });
      if(!r.ok) throw new Error("Artifact download HTTP "+r.status);
      const zip=new AdmZip(Buffer.from(await r.arrayBuffer()));
      const apk=zip.getEntries().find(x=>x.entryName.toLowerCase().endsWith(".apk"));
      if(!apk) throw new Error("APK missing in artifact");
      const safe=safeName(j.appName).replace(/[^A-Za-z0-9_-]+/g,"-")||"AI-App";
      return send(res,200,apk.getData(),{"content-type":"application/vnd.android.package-archive","content-disposition":"attachment; filename=\""+safe+".apk\""});
    }catch(e){return json(res,500,{error:e.message})}
  }
  if(req.method==="GET"){
    const rel=u.pathname==="/"?"index.html":u.pathname.slice(1);
    const file=path.join(ROOT,"public",rel);
    const base=path.join(ROOT,"public");
    if(!file.startsWith(base)) return send(res,403,"Forbidden");
    const use=fs.existsSync(file)&&!fs.statSync(file).isDirectory()?file:path.join(base,"index.html");
    const ext=path.extname(use);
    const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
    return send(res,200,fs.readFileSync(use),{"content-type":types[ext]||"application/octet-stream"});
  }
  return json(res,404,{error:"Not found"});
}
http.createServer((req,res)=>route(req,res).catch(e=>json(res,500,{error:e.message}))).listen(PORT,HOST,()=>console.log("AI App Builder on "+HOST+":"+PORT));
