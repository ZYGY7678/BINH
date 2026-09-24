
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
  const r=await fetch("https://api.github.com"+endpoint,{
    ...options,
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
  if(!r.ok) throw new Error(d.message||("GitHub HTTP "+r.status));
  return d;
}

async function askGemini(key, userPrompt) {
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
  if(!r.ok) throw new Error("Gemini HTTP "+r.status);
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
  await github(token,"/repos/"+owner+"/"+repo+"/contents/"+encodeURI(file.path),{
    method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({message:"AI App Builder: "+file.path,content:Buffer.from(file.content).toString("base64"),branch})
  });
}
async function createBranch(token,owner,repo,branch){
  const ref=await github(token,"/repos/"+owner+"/"+repo+"/git/ref/heads/main");
  await github(token,"/repos/"+owner+"/"+repo+"/git/refs",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({ref:"refs/heads/"+branch,sha:ref.object.sha})
  });
}
async function dispatch(token,owner,repo,branch,id){
  await github(token,"/repos/"+owner+"/"+repo+"/actions/workflows/build-apk.yml/dispatches",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({ref:branch,inputs:{project_id:id}})
  });
}
async function latestRun(token,owner,repo,branch){
  const d=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs?event=workflow_dispatch&branch="+encodeURIComponent(branch)+"&per_page=5");
  return d.workflow_runs?.[0]||null;
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
async function buildAndWait(token,owner,repo,branch,id,job){
  let run=null;
  for(let i=0;i<30&&!run;i++){ run=await latestRun(token,owner,repo,branch); if(!run) await wait(2000); }
  if(!run) throw new Error("GitHub Actions לא מצא את ההרצה");
  job.runId=run.id; job.runUrl=run.html_url;
  for(let i=0;i<90;i++){
    const x=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs/"+run.id);
    if(x.status==="completed"){
      if(x.conclusion!=="success"){ job.logs=await failureLogs(token,owner,repo,run.id); throw new Error("הקומפילציה נכשלה: "+x.conclusion); }
      const a=await github(token,"/repos/"+owner+"/"+repo+"/actions/runs/"+run.id+"/artifacts");
      const z=(a.artifacts||[]).find(v=>v.name==="apk-"+id&&!v.expired);
      if(!z) throw new Error("APK artifact לא נמצא");
      job.artifactId=z.id; job.status="ready"; job.stage="APK מוכן להורדה"; return;
    }
    job.status="building"; job.stage="Gradle מקמפל את ה־APK"; await wait(4000);
  }
  throw new Error("זמן הקומפילציה המקסימלי עבר");
}
async function startJob(job,creds){
  try{
    job.status="generating"; job.stage="AI מתכנן וכותב את האפליקציה";
    const spec=await askGemini(creds.geminiKey,job.prompt);
    const pkg=cleanPackage(spec.packageName), name=safeName(spec.appName);
    const map=new Map(fixedFiles(job.id,name,pkg).map(x=>[x.path,x]));
    for(const f of sanitizeFiles(job.id,spec,pkg)) map.set(f.path,f);
    job.appName=name; job.packageName=pkg; job.summary=spec.summary||"";
    job.status="uploading"; job.stage="מעלה את הפרויקט ל־GitHub";
    const branch="builder/"+job.id; job.branch=branch; job.files=[...map.values()];
    await createBranch(creds.githubToken,job.owner,job.repo,branch);
    for(const f of job.files) await putFile(creds.githubToken,job.owner,job.repo,f,branch);
    job.status="building"; job.stage="מפעיל קומפילציה ב־GitHub Actions";
    await dispatch(creds.githubToken,job.owner,job.repo,branch,job.id);
    await buildAndWait(creds.githubToken,job.owner,job.repo,branch,job.id,job);
  }catch(e){ job.status="failed"; job.error=e.message; }
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
