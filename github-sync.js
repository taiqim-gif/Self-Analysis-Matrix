// 分析シート GitHub同期アドオン
// ・「☁ 同期」ボタンから、self-diary-loop の analysis/matrix.json へ保存・読込
// ・matrix.json の relations(関連リンク)を、各項目の下に「関連」チップとして表示
// 既存のアプリ本体のコードは変更しない(localStorage 経由で連携)
(() => {
  "use strict";
  const DATA_KEY = "self_analysis_matrix_v1";
  const SET_KEY = "selfAnalysisGithubSettings";
  const SHA_KEY = "selfAnalysisGithubSha";
  const REL_KEY = "selfAnalysisRelations";
  const DIARY_SET_KEY = "shinkaronDiarySettings"; // 日記アプリと同じ端末・同じドメインなら流用
  const FILE_PATH = "analysis/matrix.json";

  const $ = (id) => document.getElementById(id);
  const readJSON = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };

  function b64Enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin);
  }
  function b64Dec(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    return new TextDecoder("utf-8").decode(new Uint8Array([...bin].map((c) => c.charCodeAt(0))));
  }

  // ---------- 設定 ----------
  function loadSettings() {
    const own = readJSON(SET_KEY, null);
    if (own && own.pat) return own;
    const d = readJSON(DIARY_SET_KEY, null);
    if (d && d.pat) return { pat: d.pat, owner: d.owner || "", repo: d.repo || "", branch: d.branch || "main" };
    return { pat: "", owner: "", repo: "", branch: "main" };
  }

  // ---------- GitHub API ----------
  const apiUrl = (s) => `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${FILE_PATH}`;
  const headers = (s) => ({ Authorization: `Bearer ${s.pat}`, Accept: "application/vnd.github+json" });

  async function getFile(s) {
    const res = await fetch(`${apiUrl(s)}?ref=${encodeURIComponent(s.branch)}`, { headers: headers(s), cache: "no-store" });
    if (res.status === 404) return { content: null, sha: null };
    if (!res.ok) throw new Error(`取得エラー: ${res.status}`);
    const j = await res.json();
    return { content: b64Dec(j.content), sha: j.sha };
  }

  async function putFile(s, text, sha) {
    const body = { message: `analysis: matrix.json update ${new Date().toISOString().slice(0, 16)}`, content: b64Enc(text), branch: s.branch };
    if (sha) body.sha = sha;
    const res = await fetch(apiUrl(s), {
      method: "PUT",
      headers: { ...headers(s), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`保存エラー: ${res.status} ${await res.text()}`);
    const j = await res.json();
    return j.content.sha;
  }

  // ---------- UI(モーダル) ----------
  const css = `
  #gsync-ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100;align-items:center;justify-content:center;padding:14px}
  #gsync-ov.open{display:flex}
  #gsync-box{background:var(--card);color:var(--text);border:2px solid var(--line);border-radius:14px;padding:14px;width:100%;max-width:420px;max-height:90vh;overflow:auto}
  #gsync-box h3{margin:0 0 8px;font-size:16px}
  #gsync-box label{display:block;font-size:11px;font-weight:800;color:var(--muted);margin:8px 0 3px}
  #gsync-box input{width:100%;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--input-bg);color:var(--text);font-size:16px}
  .gsync-row{display:flex;gap:8px;margin-top:12px}
  .gsync-row .btn{flex:1;padding:10px}
  #gsync-status{font-size:12px;color:var(--muted);margin-top:10px;min-height:1.4em;white-space:pre-wrap}
  .rel-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
  .rel-chip{font-size:10px;border:1px solid var(--line);border-radius:99px;padding:2px 8px;background:var(--head-bg);color:var(--text);cursor:pointer;font-family:inherit}
  .rel-flash{outline:3px solid var(--accent);outline-offset:2px;transition:outline .3s}`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const ov = document.createElement("div");
  ov.id = "gsync-ov";
  ov.innerHTML = `<div id="gsync-box">
    <h3>☁ GitHub同期</h3>
    <label>GitHub トークン</label><input type="password" id="gsync-pat" placeholder="github_pat_...">
    <label>オーナー</label><input type="text" id="gsync-owner" placeholder="taiqim-gif">
    <label>リポジトリ名</label><input type="text" id="gsync-repo" placeholder="self-diary-loop">
    <label>ブランチ</label><input type="text" id="gsync-branch" placeholder="main">
    <div class="gsync-row">
      <button type="button" class="btn primary" id="gsync-push">GitHubへ保存</button>
      <button type="button" class="btn" id="gsync-pull">GitHubから読込</button>
    </div>
    <div class="gsync-row"><button type="button" class="btn small" id="gsync-close">閉じる</button></div>
    <div id="gsync-status"></div>
  </div>`;
  document.body.appendChild(ov);

  const status = (m) => { $("gsync-status").textContent = m; };

  function readForm() {
    return {
      pat: $("gsync-pat").value.trim(),
      owner: $("gsync-owner").value.trim(),
      repo: $("gsync-repo").value.trim(),
      branch: $("gsync-branch").value.trim() || "main",
    };
  }
  function checkForm(s) {
    if (!s.pat || !s.owner || !s.repo) { status("トークン・オーナー・リポジトリ名を入力してください"); return false; }
    localStorage.setItem(SET_KEY, JSON.stringify(s));
    return true;
  }

  async function push() {
    const s = readForm(); if (!checkForm(s)) return;
    const local = readJSON(DATA_KEY, null);
    if (!local || !local.cells) { status("この端末に保存するデータがありません"); return; }
    status("保存中...");
    try {
      const r = await getFile(s);
      const lastSha = localStorage.getItem(SHA_KEY);
      if (r.sha && r.sha !== lastSha) {
        const msg = lastSha
          ? "GitHub側が、この端末で最後に同期した後に更新されています(別の端末で更新した可能性があります)。\nこの端末の内容で上書きしますか?"
          : "GitHubに既にデータがあります。初回は先に「読込」をおすすめします。\nこの端末の内容で上書きしますか?";
        if (!confirm(msg)) { status("中止しました"); return; }
      }
      // GitHub側にだけあるキー(relations など)は残す
      const merged = { ...local };
      if (r.content) {
        try {
          const remote = JSON.parse(r.content);
          Object.keys(remote).forEach((k) => { if (!(k in merged)) merged[k] = remote[k]; });
        } catch (e) { /* 壊れていたらローカルのみ */ }
      }
      const newSha = await putFile(s, JSON.stringify(merged, null, 2), r.sha);
      localStorage.setItem(SHA_KEY, newSha);
      localStorage.setItem(REL_KEY, JSON.stringify(merged.relations || []));
      status("保存しました ✓");
      decorate();
    } catch (e) { status("エラー: " + e.message); }
  }

  async function pull() {
    const s = readForm(); if (!checkForm(s)) return;
    status("読込中...");
    try {
      const r = await getFile(s);
      if (r.content === null) { status("GitHubに analysis/matrix.json がありません"); return; }
      const remote = JSON.parse(r.content);
      if (!remote || !remote.cells) throw new Error("形式が正しくありません");
      if (!confirm("この端末のデータを、GitHubの内容で置き換えます。よろしいですか?")) { status("中止しました"); return; }
      localStorage.setItem(DATA_KEY, JSON.stringify(remote));
      localStorage.setItem(SHA_KEY, r.sha);
      localStorage.setItem(REL_KEY, JSON.stringify(remote.relations || []));
      status("読み込みました。再読み込みします...");
      location.reload();
    } catch (e) { status("エラー: " + e.message); }
  }

  function openModal() {
    const s = loadSettings();
    $("gsync-pat").value = s.pat || ""; $("gsync-owner").value = s.owner || "";
    $("gsync-repo").value = s.repo || ""; $("gsync-branch").value = s.branch || "main";
    status(""); ov.classList.add("open");
  }

  $("gsync-push").onclick = push;
  $("gsync-pull").onclick = pull;
  $("gsync-close").onclick = () => ov.classList.remove("open");

  const actions = document.querySelector(".actions");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn small"; btn.textContent = "☁ 同期";
  btn.onclick = openModal;
  if (actions) actions.insertBefore(btn, actions.firstChild);

  // ---------- 関連(relations)チップ ----------
  function labelOf(id, data) {
    const cells = (data && data.cells) || {};
    for (const sec of Object.keys(cells)) {
      for (const cell of Object.keys(cells[sec])) {
        const b = cells[sec][cell];
        for (const it of [...(b.active || []), ...(b.history || [])]) {
          if (it.id === id) {
            const t = (it.text || it.ideal || it.current || it.a || "").replace(/\s+/g, " ").trim();
            return t.length > 16 ? t.slice(0, 16) + "…" : t || "(無題)";
          }
        }
      }
    }
    return null;
  }

  function jumpTo(id, label) {
    let el = document.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (el && el.classList.contains("lang-row")) el = el.firstElementChild;
    if (!el || el.offsetParent === null) { alert(`「${label}」は今の画面に表示されていません(履歴表示が必要かもしれません)。`); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("rel-flash");
    setTimeout(() => el.classList.remove("rel-flash"), 1600);
  }

  let observer = null, timer = null;
  function decorate() {
    if (observer) observer.disconnect();
    try {
      document.querySelectorAll(".rel-chips").forEach((n) => n.remove());
      const rels = readJSON(REL_KEY, []);
      const data = readJSON(DATA_KEY, {});
      if (rels.length) {
        document.querySelectorAll(".item[data-id], .gap-entry[data-id], .lang-row[data-id]").forEach((el) => {
          if (el.classList.contains("editing")) return;
          const id = el.dataset.id;
          const mine = rels.filter((r) => r.from === id || r.to === id);
          if (!mine.length) return;
          const wrap = document.createElement("div");
          wrap.className = "rel-chips";
          mine.forEach((r) => {
            const otherId = r.from === id ? r.to : r.from;
            const lab = labelOf(otherId, data);
            if (!lab) return;
            const c = document.createElement("button");
            c.type = "button"; c.className = "rel-chip";
            c.textContent = (r.from === id ? "→ " : "← ") + lab;
            c.title = [r.type, r.note].filter(Boolean).join(":");
            c.onclick = () => jumpTo(otherId, lab);
            wrap.appendChild(c);
          });
          if (!wrap.children.length) return;
          if (el.classList.contains("lang-row")) el.querySelector(".lang-cell").appendChild(wrap);
          else el.insertBefore(wrap, el.querySelector(".item-meta, .item-tools"));
        });
      }
    } finally {
      const target = $("view-sheets");
      if (observer && target) observer.observe(target, { childList: true, subtree: true });
    }
  }

  const target = $("view-sheets");
  if (target) {
    observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(decorate, 60); });
    observer.observe(target, { childList: true, subtree: true });
  }
  decorate();
})();
