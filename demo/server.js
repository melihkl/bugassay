// Tiny demo shop with a deliberate bug, used to try Bugassay without any real application.
//   node demo/server.js            -> http://localhost:3000   (cart total is wrong)
//   DEMO_FIXED=1 node demo/server.js  -> same app with the bug fixed
// Login: admin / demo
import http from "node:http";

const PORT = Number(process.env.DEMO_PORT || 3000);
const FIXED = process.env.DEMO_FIXED === "1";
const PRODUCTS = { 1: { name: "Widget", price: 10 }, 2: { name: "Gadget", price: 5 } };
const carts = new Map(); // sid -> { id: qty }

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const money = (n) => `$${n.toFixed(2)}`;
const cookie = (req, k) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([n]) => n === k)?.[1];

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:16px system-ui;margin:0}header{background:#222;padding:0 20px;display:flex;gap:24px}
header a,.menu>span{color:#fff;text-decoration:none;display:block;padding:14px 4px;cursor:pointer}
.menu{position:relative}.drop{display:none;position:absolute;top:100%;left:0;background:#333;min-width:140px}
.menu:hover .drop{display:block}.drop a{padding:10px 14px}main{padding:24px}button{padding:6px 12px}</style></head><body>
<header><a href="/" data-testid="nav-home">Shop</a>
<div class="menu" data-testid="nav-products"><span>Products</span><div class="drop"><a href="/catalog" data-testid="nav-catalog">Catalog</a></div></div>
<a href="/cart" data-testid="nav-cart">Cart</a></header><main>${body}</main></body></html>`;

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const sid = cookie(req, "sid");
    const send = (code, html, headers = {}) => {
      res.writeHead(code, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };
    const redirect = (to, headers = {}) => {
      res.writeHead(303, { location: to, ...headers });
      res.end();
    };
    if (url.pathname === "/health") return send(200, "ok");
    if (url.pathname === "/login") {
      if (req.method === "POST") {
        let b = "";
        req.on("data", (c) => (b += c));
        req.on("end", () => {
          const p = new URLSearchParams(b);
          if (p.get("user") === "admin" && p.get("pass") === "demo") {
            const id = Math.random().toString(36).slice(2);
            carts.set(id, {});
            return redirect("/", { "set-cookie": `sid=${id}; Path=/; HttpOnly; SameSite=Lax` });
          }
          send(401, page("Login", `<p data-testid="login-error">Wrong user or password</p><a href="/login">Try again</a>`));
        });
        return;
      }
      return send(200, page("Login", `<h1>Login</h1><form method="post"><p><input name="user" placeholder="user" data-testid="user"></p><p><input name="pass" type="password" placeholder="password" data-testid="pass"></p><button data-testid="login">Log in</button></form>`));
    }
    if (!sid || !carts.has(sid)) return redirect("/login");
    const cart = carts.get(sid);
    if (url.pathname === "/") return send(200, page("Shop", `<h1 data-testid="welcome">Welcome, admin</h1>`));
    if (url.pathname === "/catalog")
      return send(200, page("Catalog", `<h1>Catalog</h1>` + Object.entries(PRODUCTS).map(([id, p]) =>
        `<p>${esc(p.name)} ${money(p.price)} <form method="post" action="/add?id=${id}" style="display:inline"><button data-testid="add-${id}">Add to cart</button></form></p>`).join("")));
    if (url.pathname === "/add" && req.method === "POST") {
      const id = url.searchParams.get("id");
      if (PRODUCTS[id]) cart[id] = (cart[id] || 0) + 1;
      return redirect("/catalog");
    }
    if (url.pathname === "/cart") {
      const lines = Object.entries(cart);
      // THE BUG: the total ignores quantities (fixed with DEMO_FIXED=1)
      const total = lines.reduce((n, [id, q]) => n + PRODUCTS[id].price * (FIXED ? q : 1), 0);
      return send(200, page("Cart", `<h1>Cart</h1>` + lines.map(([id, q]) => `<p>${esc(PRODUCTS[id].name)} × ${q}</p>`).join("") + `<p>Total: <strong data-testid="total">${money(total)}</strong></p>`));
    }
    send(404, page("Not found", "<h1>404</h1>"));
  })
  .listen(PORT, "127.0.0.1", () => console.log(`Demo shop: http://127.0.0.1:${PORT}  (${FIXED ? "bug FIXED" : "cart total bug present"})  login: admin / demo`));
