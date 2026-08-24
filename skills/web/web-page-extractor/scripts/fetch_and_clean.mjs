const targetUrl = process.argv[2] || "https://example.com";

try {
  const res = await fetch(targetUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  let html = await res.text();
  
  html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
             .replace(/<!--[\s\S]*?-->/g, "");

  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "网页内容";

  html = html.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
             .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
             .replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n")
             .replace(/<[^>]+>/g, " ");

  const clean = html.replace(/\s+/g, " ").trim();
  console.log(`# ${title}\n\n${clean.slice(0, 2000)}`);
} catch (e) {
  console.error("抓取失败:", e.message);
}
