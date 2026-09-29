(() => {
  "use strict";

  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  let user = null, authMode = "login", selectedChat = null, chatChannel = null, commentChannel = null;
  let profilesCache = [];
  const $ = id => document.getElementById(id);
  const escapeHtml = (v="") => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const avatar = p => p?.avatar_url || "avatar-placeholder.svg";
  const toast = (() => { let t; return msg => { const e=$("toast"); e.textContent=msg; e.classList.add("show"); clearTimeout(t); t=setTimeout(()=>e.classList.remove("show"),2600); };})();
  const msg = (id,text,kind="") => { const e=$(id); if(e){e.textContent=text||""; e.dataset.kind=kind;} };
  const appUrl = () => location.origin + location.pathname;

  function showView(id) {
    if (!user) id="auth";
    document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
    $(id)?.classList.remove("hidden");
    if (id!=="auth") history.replaceState(null,"","#"+id);
    if(id==="discover") loadDiscover();
    if(id==="matches") loadMatches();
    if(id==="messages") loadChatUsers();
    if(id==="profile") loadMyProfile();
  }

  function setAuthMode(mode){
    authMode=mode;
    $("loginTab").classList.toggle("active",mode==="login");
    $("signupTab").classList.toggle("active",mode==="signup");
    $("signupFields").classList.toggle("hidden",mode==="login");
    $("authBtn").textContent=mode==="login"?"Log in":"Create account";
    $("password").autocomplete=mode==="login"?"current-password":"new-password";
    msg("authMsg","");
  }

  async function authSubmit(e){
    e.preventDefault(); msg("authMsg","");
    const email=$("email").value.trim(), password=$("password").value;
    if(!email || password.length<6) return msg("authMsg","Enter a valid email and a password of at least 6 characters.");
    if(authMode==="signup"){
      const age=Number($("age").value);
      if(!Number.isInteger(age)||age<18) return msg("authMsg","Connectly is for adults 18+ only.");
      if(!$("ageConfirm").checked) return msg("authMsg","Please confirm that you are 18 or older.");
      const {data,error}=await client.auth.signUp({email,password,options:{data:{
        name:$("name").value.trim(),age,gender:$("gender").value,city:$("city").value.trim(),
        looking_for:$("lookingFor").value,bio:$("bio").value.trim()
      },emailRedirectTo:appUrl()}});
      if(error) return msg("authMsg",error.message);
      if(data.session) await finishLogin(data.session.user);
      else msg("authMsg","Account created. Check your email if email confirmation is enabled, then log in.","ok");
      return;
    }
    const {data,error}=await client.auth.signInWithPassword({email,password});
    if(error) return msg("authMsg",error.message);
    if(data.user) await finishLogin(data.user);
  }

  async function finishLogin(u){
    user=u; $("nav").classList.remove("hidden"); await ensureProfile(u);
    await client.rpc("touch_profile").catch(()=>{});
    await updateMatchCount(); showView(location.hash.slice(1)||"discover");
  }

  async function ensureProfile(u){
    const {data}=await client.from("profiles").select("*").eq("id",u.id).maybeSingle();
    if(data) return;
    const m=u.user_metadata||{};
    await client.from("profiles").insert({
      id:u.id,name:m.name||"",age:Math.max(18,Number(m.age)||18),gender:m.gender||"",
      city:m.city||"",looking_for:m.looking_for||"everyone",bio:m.bio||"",interests:[],
      min_age:18,max_age:100,status_text:""
    });
  }

  async function boot(){
    if(!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY) return msg("authMsg","Supabase configuration is missing.");
    const {data}=await client.auth.getSession();
    if(data.session) await finishLogin(data.session.user); else showView("auth");
    client.auth.onAuthStateChange(async(_,session)=>{
      if(session?.user) user=session.user;
      else { user=null; $("nav").classList.add("hidden"); if(chatChannel) client.removeChannel(chatChannel); showView("auth"); }
    });
  }

  async function forgot(){
    const email=$("email").value.trim();
    if(!email) return msg("authMsg","Enter your email first.");
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:appUrl()});
    msg("authMsg",error?.message||"Password reset email sent.","ok");
  }

  async function updateMatchCount(){
    if(!user) return;
    const {data:out}=await client.from("likes").select("to_user").eq("from_user",user.id);
    const {data:inb}=await client.from("likes").select("from_user").eq("to_user",user.id);
    const incoming=new Set((inb||[]).map(x=>x.from_user));
    $("matchCount").textContent=String((out||[]).filter(x=>incoming.has(x.to_user)).length);
  }

  async function getMatches(){
    const {data:out,error:e1}=await client.from("likes").select("to_user").eq("from_user",user.id);
    const {data:inb,error:e2}=await client.from("likes").select("from_user").eq("to_user",user.id);
    if(e1||e2) throw new Error(e1?.message||e2?.message||"Could not load matches.");
    const ids=(out||[]).map(x=>x.to_user).filter(id=>new Set((inb||[]).map(x=>x.from_user)).has(id));
    if(!ids.length) return [];
    const {data,error}=await client.from("profiles").select("*").in("id",ids);
    if(error) throw new Error(error.message); return data||[];
  }

  async function loadDiscover(){
    if(!user) return;
    const box=$("profiles"); box.innerHTML=Array(6).fill('<div class="skeleton"></div>').join("");
    let q=client.from("profiles").select("id,name,age,gender,city,bio,interests,avatar_url,status_text,last_seen").neq("id",user.id).eq("is_blocked",false).order("last_seen",{ascending:false}).limit(60);
    const g=$("genderFilter").value, interest=$("interestFilter").value, search=$("searchInput").value.trim();
    if(g!=="all") q=q.eq("gender",g);
    if(interest!=="all") q=q.contains("interests",[interest]);
    const {data,error}=await q;
    if(error){box.innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return;}
    const {data:likes}=await client.from("likes").select("to_user").eq("from_user",user.id);
    const {data:passes}=await client.from("passes").select("to_user").eq("from_user",user.id);
    const hidden=new Set([...(likes||[]).map(x=>x.to_user),...(passes||[]).map(x=>x.to_user)]);
    const s=search.toLowerCase();
    profilesCache=(data||[]).filter(p=>!hidden.has(p.id)&&(!s||[p.name,p.city,p.bio,p.status_text].some(x=>String(x||"").toLowerCase().includes(s))));
    box.innerHTML=profilesCache.length?profilesCache.map(card).join(""):'<div class="empty">No profiles match these filters. Try clearing a filter.</div>';
  }

  function card(p){
    const tags=(p.interests||[]).slice(0,6).map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join("");
    const online=p.last_seen && Date.now()-new Date(p.last_seen).getTime()<5*60*1000;
    return `<article class="profile">
      <div class="profile-cover"><img src="${escapeHtml(avatar(p))}" alt="${escapeHtml(p.name||"Member")}" loading="lazy" onerror="this.src='avatar-placeholder.svg'">
      <button class="profile-open" data-profile="${p.id}">View profile</button></div>
      <div class="body"><h3>${escapeHtml(p.name||"Member")}, ${escapeHtml(p.age||"")}</h3>
      <div class="muted">${online?'<span class="online-dot"></span>Online · ':''}${escapeHtml(p.city||"")}</div>
      ${p.status_text?`<p class="muted">${escapeHtml(p.status_text)}</p>`:""}
      <p class="bio">${escapeHtml(p.bio||"")}</p><div class="tags">${tags}</div>
      <div class="actions"><button class="pass" data-pass="${p.id}">Pass</button><button class="like" data-like="${p.id}">Like ♥</button></div>
      <div class="tools"><button class="link" data-report="${p.id}">Report</button><button class="link" data-block="${p.id}">Block</button></div></div>
    </article>`;
  }

  async function like(id){
    const {error}=await client.from("likes").upsert({from_user:user.id,to_user:id},{onConflict:"from_user,to_user"});
    if(error) return toast(error.message);
    await client.from("passes").delete().eq("from_user",user.id).eq("to_user",id);
    const {data}=await client.from("likes").select("from_user").eq("from_user",id).eq("to_user",user.id).maybeSingle();
    if(data){
      toast("It's a match!");
      await client.from("notifications").insert([{user_id:id,actor_id:user.id,type:"match",text:"You have a new match!",link:"#messages"}]).catch(()=>{});
    } else toast("Like sent.");
    await updateMatchCount(); loadDiscover();
  }

  async function pass(id){
    const {error}=await client.from("passes").upsert({from_user:user.id,to_user:id},{onConflict:"from_user,to_user"});
    if(error) return toast(error.message); loadDiscover();
  }

  async function block(id){
    if(!confirm("Block this profile?")) return;
    const {error}=await client.from("blocks").upsert({blocker_id:user.id,blocked_id:id},{onConflict:"blocker_id,blocked_id"});
    if(error) return toast(error.message); toast("Profile blocked."); loadDiscover();
  }

  async function report(id){
    const reason=prompt("Briefly describe the reason for this report:");
    if(!reason||reason.trim().length<3) return;
    const {error}=await client.from("reports").insert({reporter_id:user.id,reported_id:id,reason:reason.trim()});
    toast(error?error.message:"Report submitted.");
  }

  async function loadMatches(){
    const box=$("matchesList"); box.innerHTML='<div class="empty">Loading matches...</div>';
    try{
      const ms=await getMatches();
      box.innerHTML=ms.length?ms.map(p=>`<article class="card" style="padding:18px;display:flex;gap:14px;align-items:center"><img src="${escapeHtml(avatar(p))}" onerror="this.src='avatar-placeholder.svg'" style="width:82px;height:82px;border-radius:18px;object-fit:cover"><div style="flex:1"><h3 style="margin:0">${escapeHtml(p.name||"Match")}, ${escapeHtml(p.age||"")}</h3><p class="muted">${escapeHtml(p.city||"")}</p><button class="primary" data-open-chat="${p.id}">Message</button><button class="secondary" data-profile="${p.id}" style="margin-left:6px">Profile</button></div></article>`).join(""):'<div class="empty">Your mutual matches will appear here.</div>';
    }catch(e){box.innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
  }

  async function loadChatUsers(){
    const box=$("chatUsers");
    try{
      const ms=await getMatches();
      box.innerHTML=ms.length?ms.map(p=>`<button class="person ${selectedChat===p.id?"active":""}" data-open-chat="${p.id}"><img src="${escapeHtml(avatar(p))}" onerror="this.src='avatar-placeholder.svg'"><span><b>${escapeHtml(p.name||"Member")}</b><br><small>${escapeHtml(p.city||"")}</small></span></button>`).join(""):'<div class="empty">No matches yet.</div>';
      if(selectedChat) await loadMessages();
    }catch(e){box.innerHTML=`<div class="empty">${escapeHtml(e.message)}</div>`;}
  }

  async function openChat(id){selectedChat=id;showView("messages");}

  async function loadMessages(){
    if(!selectedChat) return;
    const {data:p}=await client.from("profiles").select("name,age,city").eq("id",selectedChat).single();
    $("chatTitle").textContent=p?`${p.name||"Match"}, ${p.age}${p.city?" · "+p.city:""}`:"Chat";
    const f=`and(sender_id.eq.${user.id},receiver_id.eq.${selectedChat}),and(sender_id.eq.${selectedChat},receiver_id.eq.${user.id})`;
    const {data,error}=await client.from("messages").select("id,sender_id,body,created_at").or(f).order("created_at",{ascending:true}).limit(200);
    if(error){$("chatLog").innerHTML=`<div class="empty">${escapeHtml(error.message)}</div>`;return;}
    $("chatLog").innerHTML=(data||[]).map(m=>`<div class="bubble ${m.sender_id===user.id?"me":"them"}">${escapeHtml(m.body)}<small>${new Date(m.created_at).toLocaleString()}</small></div>`).join("")||'<div class="empty">Start the conversation.</div>';
    $("chatLog").scrollTop=$("chatLog").scrollHeight;
    if(chatChannel) client.removeChannel(chatChannel);
    chatChannel=client.channel("chat-"+[user.id,selectedChat].sort().join("-")).on("postgres_changes",{event:"INSERT",schema:"public",table:"messages"},payload=>{
      const m=payload.new;if((m.sender_id===user.id&&m.receiver_id===selectedChat)||(m.sender_id===selectedChat&&m.receiver_id===user.id))loadMessages();
    }).subscribe();
  }

  async function sendMessage(e){
    e.preventDefault();const body=$("message").value.trim();if(!body||!selectedChat)return;
    const {error}=await client.from("messages").insert({sender_id:user.id,receiver_id:selectedChat,body});
    if(error)toast(error.message);else{$("message").value="";await loadMessages();}
  }

  async function loadMyProfile(){
    const {data,error}=await client.from("profiles").select("*").eq("id",user.id).single();
    if(error)return msg("profileMsg",error.message);
    $("pname").value=data.name||"";$("page").value=data.age||18;$("pgender").value=data.gender||"";$("pcity").value=data.city||"";
    $("plookingFor").value=data.looking_for||"everyone";$("pminAge").value=data.min_age||18;$("pmaxAge").value=data.max_age||100;
    $("pbio").value=data.bio||"";$("pinterests").value=(data.interests||[]).join(", ");$("pstatus").value=data.status_text||"";$("profilePreview").src=avatar(data);
    await loadGallery();
  }

  async function saveProfile(e){
    e.preventDefault();
    const age=Number($("page").value), min=Number($("pminAge").value)||18, max=Number($("pmaxAge").value)||100;
    if(age<18||min<18||max<min)return msg("profileMsg","Please enter a valid adult age range.");
    const interests=$("pinterests").value.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,20);
    const {error}=await client.from("profiles").update({
      name:$("pname").value.trim(),age,gender:$("pgender").value,city:$("pcity").value.trim(),
      looking_for:$("plookingFor").value,min_age:min,max_age:max,bio:$("pbio").value.trim(),
      interests,status_text:$("pstatus").value.trim(),last_seen:new Date().toISOString()
    }).eq("id",user.id);
    msg("profileMsg",error?.message||"Profile saved.","ok");if(!error)toast("Profile saved.");
  }

  async function uploadOne(file,isPrimary=false){
    if(!file||!file.type.startsWith("image/"))return toast("Choose an image file.");
    if(file.size>5*1024*1024)return toast("Each photo must be 5 MB or smaller.");
    const ext=(file.name.split(".").pop()||"jpg").toLowerCase(), path=`${user.id}/${crypto.randomUUID()}.${ext}`;
    const {error}=await client.storage.from("profile-media").upload(path,file,{contentType:file.type,upsert:false});
    if(error)return toast(error.message);
    const {data:u}=client.storage.from("profile-media").getPublicUrl(path);
    if(isPrimary){
      const {error:e}=await client.from("profiles").update({avatar_url:u.publicUrl}).eq("id",user.id);
      if(e)return toast(e.message);
      $("profilePreview").src=u.publicUrl;
    }
    const {error:e}=await client.from("profile_photos").insert({user_id:user.id,storage_path:path,public_url:u.publicUrl,is_primary:isPrimary});
    if(e)return toast(e.message);
    toast(isPrimary?"Profile photo updated":"Photo added");await loadGallery();
  }

  async function loadGallery(){
    const {data,error}=await client.from("profile_photos").select("id,public_url,is_primary,storage_path").eq("user_id",user.id).order("created_at",{ascending:true});
    if(error){$("myGallery").innerHTML="";return;}
    $("photoCount").textContent=`${data.length}/8`;
    $("myGallery").innerHTML=data.map(p=>`<div class="gallery-item"><img src="${escapeHtml(p.public_url)}" loading="lazy"><button title="Delete photo" data-delete-photo="${p.id}" data-path="${escapeHtml(p.storage_path)}">×</button></div>`).join("");
  }

  async function addGallery(files){
    const current=await client.from("profile_photos").select("id").eq("user_id",user.id);
    let count=(current.data||[]).length;
    for(const file of files){if(count>=8){toast("Maximum 8 photos.");break;}await uploadOne(file,count===0);count++;}
  }

  async function deletePhoto(id,path){
    if(!confirm("Delete this photo?"))return;
    await client.storage.from("profile-media").remove([path]);
    const {error}=await client.from("profile_photos").delete().eq("id",id);
    if(error)toast(error.message);else{toast("Photo deleted");await loadGallery();await loadMyProfile();}
  }

  async function viewProfile(id){
    const {data:p,error}=await client.from("profiles").select("*").eq("id",id).single();
    if(error)return toast(error.message);
    const {data:photos}=await client.from("profile_photos").select("id,public_url,is_primary").eq("user_id",id).order("created_at");
    const {data:comments}=await client.from("profile_comments").select("id,author_id,body,created_at").eq("profile_id",id).order("created_at",{ascending:false}).limit(50);
    const ids=[...(comments||[]).map(c=>c.author_id),id];
    const {data:authors}=await client.from("profiles").select("id,name,avatar_url").in("id",ids);
    const amap=Object.fromEntries((authors||[]).map(a=>[a.id,a]));
    const gallery=(photos||[]).map(x=>`<img src="${escapeHtml(x.public_url)}" loading="lazy" alt="Profile photo">`).join("");
    const list=(comments||[]).map(c=>`<div class="comment"><strong>${escapeHtml(amap[c.author_id]?.name||"Member")}</strong><span>${escapeHtml(c.body)}</span><small>${new Date(c.created_at).toLocaleString()}</small>${c.author_id===user.id||id===user.id?`<button class="link" data-delete-comment="${c.id}">Delete</button>`:""}</div>`).join("");
    const tags=(p.interests||[]).map(x=>`<span class="tag">${escapeHtml(x)}</span>`).join("");
    $("publicProfileBox").innerHTML=`<div class="profile-detail">
      <button class="secondary" data-view="discover">← Back to Discover</button>
      <div class="detail-card" style="margin-top:14px"><div><img class="detail-main-photo" src="${escapeHtml(avatar(p))}" onerror="this.src='avatar-placeholder.svg'" alt="${escapeHtml(p.name||"Member")}"><div class="detail-gallery">${gallery}</div></div>
      <div class="detail-body"><p class="eyebrow">PROFILE</p><h1>${escapeHtml(p.name||"Member")}, ${escapeHtml(p.age)}</h1><p class="muted">${escapeHtml(p.gender||"")} ${p.city?"· "+escapeHtml(p.city):""}</p>${p.status_text?`<p>${escapeHtml(p.status_text)}</p>`:""}<p>${escapeHtml(p.bio||"")}</p><div class="tags">${tags}</div>
      <div class="detail-actions"><button class="like primary" data-like="${id}">Like ♥</button><button class="pass secondary" data-pass="${id}">Pass</button><button class="secondary" data-block="${id}">Block</button></div>
      <div class="comment-box"><h3>Comments</h3><form class="comment-form" id="commentForm"><input id="commentInput" maxlength="500" placeholder="Leave a respectful comment..."><button class="primary">Post</button></form><div class="comment-list" id="commentList">${list||'<p class="muted">No comments yet.</p>'}</div></div>
      </div></div></div>`;
    showView("publicProfile"); subscribeComments(id);
  }

  function subscribeComments(profileId){
    if(commentChannel)client.removeChannel(commentChannel);
    commentChannel=client.channel("comments-"+profileId).on("postgres_changes",{event:"*",schema:"public",table:"profile_comments",filter:`profile_id=eq.${profileId}`},()=>viewProfile(profileId)).subscribe();
  }

  async function postComment(e){
    e.preventDefault();const body=$("commentInput")?.value.trim();const box=$("publicProfileBox");if(!body)return;
    const profileId=box.querySelector("[data-like]")?.dataset.like;if(!profileId)return;
    const {error}=await client.from("profile_comments").insert({profile_id:profileId,author_id:user.id,body});
    if(error)toast(error.message);else{toast("Comment posted");await viewProfile(profileId);}
  }

  async function deleteComment(id){
    const {error}=await client.from("profile_comments").delete().eq("id",id);
    toast(error?.message||"Comment deleted.");
    const profileId=$("publicProfileBox").querySelector("[data-like]")?.dataset.like;if(profileId)await viewProfile(profileId);
  }

  document.addEventListener("click",e=>{
    const v=e.target.closest("[data-view]");if(v){e.preventDefault();showView(v.dataset.view);return;}
    const p=e.target.closest("[data-profile]");if(p){viewProfile(p.dataset.profile);return;}
    const l=e.target.closest("[data-like]");if(l){like(l.dataset.like);return;}
    const pa=e.target.closest("[data-pass]");if(pa){pass(pa.dataset.pass);return;}
    const b=e.target.closest("[data-block]");if(b){block(b.dataset.block);return;}
    const r=e.target.closest("[data-report]");if(r){report(r.dataset.report);return;}
    const c=e.target.closest("[data-open-chat]");if(c){openChat(c.dataset.openChat);return;}
    const d=e.target.closest("[data-delete-photo]");if(d){deletePhoto(d.dataset.deletePhoto,d.dataset.path);return;}
    const dc=e.target.closest("[data-delete-comment]");if(dc){deleteComment(dc.dataset.deleteComment);return;}
  });

  $("loginTab").onclick=()=>setAuthMode("login");$("signupTab").onclick=()=>setAuthMode("signup");
  $("authForm").onsubmit=authSubmit;$("forgotBtn").onclick=forgot;$("logoutBtn").onclick=()=>client.auth.signOut();
  $("refreshDiscover").onclick=loadDiscover;$("clearFilters").onclick=()=>{$("searchInput").value="";$("interestFilter").value="all";$("genderFilter").value="all";loadDiscover();};
  $("searchInput").oninput=()=>{clearTimeout(window._searchTimer);window._searchTimer=setTimeout(loadDiscover,220);};
  $("interestFilter").onchange=loadDiscover;$("genderFilter").onchange=loadDiscover;
  $("messageForm").onsubmit=sendMessage;$("profileForm").onsubmit=saveProfile;
  $("photoFile").onchange=e=>{const f=e.target.files?.[0];if(f)uploadOne(f,true);};
  $("galleryFiles").onchange=e=>{if(e.target.files?.length)addGallery([...e.target.files]);e.target.value="";};
  document.addEventListener("submit",e=>{if(e.target.id==="commentForm")postComment(e);});
  setAuthMode("login");boot();
})();