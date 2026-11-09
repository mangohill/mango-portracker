// ── Odoo credit card transactions (?odooTxns=1&since=YYYY-MM-DD&key=TOKEN) ─
// Proxies Odoo so the API key never reaches the browser. Needs Worker secrets:
//   ODOO_URL (https://yourco.odoo.com), ODOO_DB, ODOO_KEY (API key),
//   ODOO_SYNC_TOKEN (any long random string — also entered once in the app),
//   ODOO_JOURNAL_ID (optional, comma-separated card journal id(s)),
//   ODOO_LOGIN (optional — set ONLY for pre-19 Odoo to use the legacy /jsonrpc API).
// Token travels as a query param so this stays a plain GET (no CORS preflight),
// like every other endpoint here.
if (url.searchParams.get("odooTxns") === "1") {
  const bad = (msg, status) => new Response(JSON.stringify({ error: msg }), { status, headers: CORS });
  if (!env.ODOO_SYNC_TOKEN || !env.ODOO_URL || !env.ODOO_KEY) return bad("Odoo secrets not configured on Worker", 500);
  if (url.searchParams.get("key") !== env.ODOO_SYNC_TOKEN) return bad("Unauthorized", 401);
  try {
    const since = url.searchParams.get("since") || "";
    const domain = [];
    if (since && /^\d{4}-\d{2}-\d{2}$/.test(since)) domain.push(["date", ">=", since]);
    if (env.ODOO_JOURNAL_ID) domain.push(["journal_id", "in", env.ODOO_JOURNAL_ID.split(",").map(Number)]);
    const fields = ["id", "date", "payment_ref", "amount", "partner_id", "journal_id"];
    const base = env.ODOO_URL.replace(/\/+$/, "");
    const PAGE = 500;
    const rows = [];
    let uid = null;
    for (let offset = 0; offset < PAGE * 20; offset += PAGE) {
      let page;
      if (!env.ODOO_LOGIN) {
        // Odoo 19+ JSON-2 API
        const r = await fetch(base + "/json/2/account.bank.statement.line/search_read", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "bearer " + env.ODOO_KEY, "X-Odoo-Database": env.ODOO_DB || "" },
          body: JSON.stringify({ domain, fields, order: "id asc", limit: PAGE, offset })
        });
        if (!r.ok) return bad("Odoo " + r.status + ": " + (await r.text()).slice(0, 200), 502);
        page = await r.json();
      } else {
        // Legacy JSON-RPC (Odoo ≤18): API key is used as the password
        const rpc = async (service, method, args) => {
          const r = await fetch(base + "/jsonrpc", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: 1 }) });
          const j = await r.json();
          if (j.error) throw new Error(j.error.data?.message || j.error.message);
          return j.result;
        };
        if (uid == null) uid = await rpc("common", "authenticate", [env.ODOO_DB, env.ODOO_LOGIN, env.ODOO_KEY, {}]);
        if (!uid) return bad("Odoo authentication failed", 502);
        page = await rpc("object", "execute_kw", [env.ODOO_DB, uid, env.ODOO_KEY, "account.bank.statement.line", "search_read",
          [domain], { fields, order: "id asc", limit: PAGE, offset }]);
      }
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return new Response(JSON.stringify({
      ok: true,
      rows: rows.map(x => ({
        id: x.id, date: x.date, amount: x.amount,
        merchant: Array.isArray(x.partner_id) ? x.partner_id[1] : (x.payment_ref || ""),
        ref: x.payment_ref || "",
        journalId: Array.isArray(x.journal_id) ? x.journal_id[0] : (x.journal_id && typeof x.journal_id === "object" ? x.journal_id.id : x.journal_id),
        journal: Array.isArray(x.journal_id) ? x.journal_id[1] : ((x.journal_id && x.journal_id.display_name) || "")
      }))
    }), { headers: CORS });
  } catch (e) { return bad(e.message, 502); }
}