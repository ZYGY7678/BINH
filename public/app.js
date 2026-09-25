
const $=s=>document.querySelector(s);
const keys={gh:"aib_gh",gem:"aib_gem",owner:"aib_owner",repo:"aib_repo",job:"aib_last_job"};
const promptEl=$("#prompt"), buildBtn=$("#buildBtn"), dialog=$("#settingsDialog");
function load(){ $("#githubToken").value=localStorage.getItem(keys.gh)||"";$("#geminiKey").value=localStorage.getItem(keys.gem)||"";$("#owner").value=localStorage.getItem(keys.owner)||"ZYGY7678";$("#repo").value=localStorage.getItem(keys.repo)||"BINH"; updateConn(); }
function cfg(){return{githubToken:$("#githubToken").value.trim(),geminiKey:$("#geminiKey").value.trim(),owner:$("#owner").value.trim()||"ZYGY7678",repo:$("#repo").value.trim()||"BINH"}}
function updateConn(){const ok=!!localStorage.getItem(keys.gh)&&!!localStorage.getItem(keys.gem);$("#connectionPill").textContent=ok?"מחובר":"לא מחובר";$("#connectionPill").className="pill "+(ok?"on":"off");$("#hint").textContent=ok?"מוכן לבנייה":"הגדר GitHub ו־Gemini דרך ⚙ לפני הבנייה."}
promptEl.addEventListener("input",()=>$("#count").textContent=promptEl.value.length.toLocaleString("he-IL")+" / 12000");
document.querySelectorAll(".chips button").forEach(b=>b.onclick=()=>{promptEl.value=b.dataset.example;promptEl.dispatchEvent(new Event("input"));promptEl.focus()});
$("#settingsBtn").onclick=()=>dialog.showModal();
$("#closeSettings").onclick=()=>dialog.close();
$("#settingsForm").onsubmit=e=>{e.preventDefault();const c=cfg();localStorage.setItem(keys.gh,c.githubToken);localStorage.setItem(keys.gem,c.geminiKey);localStorage.setItem(keys.owner,c.owner);localStorage.setItem(keys.repo,c.repo);updateConn();dialog.close();};
$("#testBtn").onclick=async()=>{const o=$("#testResult"),c=cfg();o.className="test";o.textContent="בודק…";try{const r=await fetch("/api/validate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(c)});const d=await r.json();if(!r.ok)throw new Error(d.error||"נכשל");o.className="test ok";o.textContent="✓ GitHub: "+d.githubUser+" • "+d.repo+" • Gemini: "+d.model}catch(e){o.className="test bad";o.textContent="✕ "+e.message}};
let timer=null;
function stage(s){document.querySelectorAll(".stage").forEach(x=>{x.classList.remove("active","done");if(s==="ready")x.classList.add("done");else if(s==="fixing"&&x.dataset.stage==="building")x.classList.add("active");else if(x.dataset.stage===s)x.classList.add("active")});const widths={queued:4,generating:25,uploading:50,fixing:82,building:76,ready:100,failed:100};$("#barFill").style.width=(widths[s]||8)+"%";}
const pollErrors={};
async function poll(id){
  if(!id)return;
  try{
    const cfgNow=cfg();
    const r=await fetch("/api/build/"+encodeURIComponent(id),{
      cache:"no-store",
      headers:{
        "Authorization":"Bearer "+cfgNow.githubToken,
        "X-GitHub-Owner":cfgNow.owner,
        "X-GitHub-Repo":cfgNow.repo
      }
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"לא נמצא");
    pollErrors[id]=0;
    $("#jobSubtitle").textContent=d.stage||"";
    stage(d.status);
    $("#jobStatus").textContent=d.status==="ready"?"מוכן":d.status==="failed"?"נכשל":d.status==="fixing"?"מתקן":"בתהליך";
    if(d.status==="ready"){
      clearInterval(timer);buildBtn.disabled=false;
      $("#jobTitle").textContent=d.appName||"האפליקציה מוכנה";
      const result=document.createElement("div");
      result.className="success";
      const title=document.createElement("div");
      title.className="result-title";
      title.textContent="✓ ה־APK מוכן";
      const meta=document.createElement("div");
      meta.className="result-meta";
      meta.textContent=d.packageName||"";
      const downloadButton=document.createElement("button");
      downloadButton.id="download";
      downloadButton.className="download";
      downloadButton.textContent="הורד APK";
      result.append(title,meta,downloadButton);
      if(d.runUrl){
        try{
          const runUrl=new URL(d.runUrl);
          if(runUrl.protocol==="https:"&&runUrl.hostname==="github.com"){
            const link=document.createElement("a");
            link.className="download";
            link.target="_blank";
            link.rel="noopener";
            link.href=runUrl.href;
            link.textContent="GitHub Actions";
            result.append(document.createTextNode(" "),link);
          }
        }catch{}
      }
      $("#jobResult").replaceChildren(result);
      $("#download").onclick=async()=>{
        try{
          const cc=cfg();
          const rr=await fetch("/api/build/"+encodeURIComponent(id)+"/download",{
            cache:"no-store",
            headers:{
              "Authorization":"Bearer "+cc.githubToken,
              "X-GitHub-Owner":cc.owner,
              "X-GitHub-Repo":cc.repo
            }
          });
          if(!rr.ok){
            const dd=await rr.json().catch(()=>({}));
            throw new Error(dd.error||"הורדת ה־APK נכשלה");
          }
          const blob=await rr.blob();
          const url=URL.createObjectURL(blob);
          const a=document.createElement("a");
          a.href=url;a.download=(d.appName||"AI-App")+".apk";
          document.body.appendChild(a);a.click();a.remove();
          setTimeout(()=>URL.revokeObjectURL(url),1000);
        }catch(e){$("#jobSubtitle").textContent=e.message}
      };
    }else if(d.status==="failed"){
      clearInterval(timer);buildBtn.disabled=false;
      $("#jobTitle").textContent="הבנייה נכשלה";
      const result=document.createElement("div");
      result.className="error";
      const title=document.createElement("div");
      title.className="result-title";
      title.textContent="הקומפילציה נכשלה";
      const meta=document.createElement("div");
      meta.className="result-meta";
      meta.textContent=d.error||"שגיאה לא ידועה";
      result.append(title,meta);
      $("#jobResult").replaceChildren(result);
      if(d.logs){$("#logsBox").classList.remove("hidden");$("#logs").textContent=d.logs}
    }
  }catch(e){
    pollErrors[id]=(pollErrors[id]||0)+1;
    $("#jobSubtitle").textContent="שגיאת תקשורת ("+pollErrors[id]+"/4): "+e.message;
    if(pollErrors[id]>=4){
      clearInterval(timer);buildBtn.disabled=false;
      $("#jobTitle").textContent="לא ניתן לקבל את מצב הבנייה";
      const result=document.createElement("div");
      result.className="error";
      const title=document.createElement("div");
      title.className="result-title";
      title.textContent="חיבור לשרת נכשל";
      const meta=document.createElement("div");
      meta.className="result-meta";
      meta.textContent="בדוק את החיבור ואת הגדרות GitHub/Gemini ונסה שוב.";
      result.append(title,meta);
      $("#jobResult").replaceChildren(result);
    }
  }
}
buildBtn.onclick=async()=>{const c=cfg();if(!c.githubToken||!c.geminiKey){dialog.showModal();return}const p=promptEl.value.trim();if(p.length<5){promptEl.focus();return}clearInterval(timer);timer=null;buildBtn.disabled=true;$("#jobPanel").classList.remove("hidden");$("#jobTitle").textContent="בונה את האפליקציה…";$("#jobResult").replaceChildren();$("#logsBox").classList.add("hidden");stage("queued");try{
  const r=await fetch("/api/build",{
    method:"POST",
    cache:"no-store",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({...c,prompt:p})
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"לא ניתן להתחיל");
  localStorage.setItem(keys.job,d.jobId);
  timer=setInterval(()=>poll(d.jobId),3000);
  poll(d.jobId)}catch(e){buildBtn.disabled=false;$("#jobSubtitle").textContent=e.message;stage("failed")}};
load();
promptEl.dispatchEvent(new Event("input"));
const lastJob=localStorage.getItem(keys.job);
if(lastJob){
  $("#jobPanel").classList.remove("hidden");
  $("#jobTitle").textContent="בודק את הבנייה האחרונה…";
  $("#jobSubtitle").textContent="מתחבר לשרת";
  poll(lastJob);
}
