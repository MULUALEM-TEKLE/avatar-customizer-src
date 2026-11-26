// inject.mjs <dir> (temps build only): add the temps page-view snippet before </head> in each .html under <dir> (built output only)
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const dir = process.argv[2]
const snip = "<script>(function(){try{var q=location.search,u=new URLSearchParams(q);fetch(\"/api/_temps/event\",{method:\"POST\",headers:{\"Content-Type\":\"application/json\"},keepalive:true,body:JSON.stringify({event_name:\"page_view\",event_data:{source:u.get(\"ref\")||u.get(\"utm_source\")||\"\"},request_path:location.pathname,request_query:q,referrer:document.referrer||null,page_title:document.title,language:navigator.language,screen_width:screen.width,screen_height:screen.height,viewport_width:innerWidth,viewport_height:innerHeight})}).catch(function(){})}catch(e){}})()</script>"
let n = 0
for (const f of readdirSync(dir, { recursive: true })) {
	if (!String(f).endsWith(".html")) continue
	const p = join(dir, String(f)), s = readFileSync(p, "utf8")
	if (s.includes("_temps/event") || !/<\/head>/i.test(s)) continue
	writeFileSync(p, s.replace(/<\/head>/i, snip + "</head>")); n++
}
console.log(`analytics snippet added to ${n} html files in ${dir}`)
if (!n) process.exit(1)
