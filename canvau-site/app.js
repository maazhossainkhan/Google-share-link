(() => {
  const cfg = window.CANVAU_CONFIG || {};
  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData ? tg.initData : "";
  const byId = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));
  let currentUser = null;
  let isAdmin = false;
  let toastTimer = null;

  function toast(message) {
    const el = byId("toast");
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
  }

  function setConnection(message, online) {
    byId("connection-state").textContent = message;
    byId("connection-state").style.color = online ? "var(--mint)" : "var(--amber)";
  }

  async function invoke(functionName, body) {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) throw new Error("Canvau config.js is not configured.");
    const response = await fetch(cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/" + functionName, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + cfg.SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || "Request failed (" + response.status + ")");
    return data;
  }

  async function authenticate() {
    if (!initData) {
      byId("welcome").classList.add("hidden");
      byId("outside-telegram").classList.remove("hidden");
      setConnection("Open in Telegram", false);
      return;
    }
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor("#0b1220");
      tg.setBackgroundColor("#0b1220");
    }
    setConnection("Verifying", false);
    const auth = await invoke("telegram-mini-auth", { initData });
    currentUser = auth.telegramUser;
    const who = await invoke("canvau-api", { initData, action: "whoami" });
    isAdmin = Boolean(who.isAdmin);
    byId("welcome").classList.remove("hidden");
    byId("dashboard").classList.remove("hidden");
    byId("user-title").textContent = (currentUser.first_name || "Your") + "'s links";
    byId("access-pill").textContent = who.accessStatus;
    byId("access-pill").className = "pill" + (who.accessStatus === "approved" ? " approved" : "");
    byId("connection-state").textContent = "Connected";
    setConnection("Connected", true);

    if (who.accessStatus !== "approved" && !isAdmin) {
      byId("create-form").classList.add("hidden");
      byId("created-result").classList.add("hidden");
      byId("links-list").innerHTML = '<div class="empty">Your access request is ' + esc(who.accessStatus) + '. A Canvau administrator must approve it before you can create links.</div>';
      byId("link-count").textContent = "—";
      return;
    }
    await loadLinks();
    if (isAdmin) {
      byId("admin-panel").classList.remove("hidden");
      await loadRequests();
    }
  }

  async function loadLinks() {
    const result = await invoke("canvau-api", { initData, action: "list" });
    const links = result.links || [];
    byId("link-count").textContent = links.length + (links.length === 1 ? " link" : " links");
    if (!links.length) {
      byId("links-list").innerHTML = '<div class="empty">No links yet. Create your first Canvau short link above.</div>';
      return;
    }
    byId("links-list").innerHTML = links.map((link) => {
      const ready = link.google_share_status === "captured" && link.google_share_url;
      return '<article class="link-card" data-id="' + esc(link.id) + '">' +
        '<div class="link-top"><div class="link-short">' + esc(link.short_url) + '</div>' +
        '<span class="google-state ' + (ready ? "ready" : "") + '">' + (ready ? "Google link saved" : "Google link not attached") + '</span></div>' +
        '<div class="link-dest">' + esc(link.original_url) + '</div>' +
        '<div class="link-meta"><span>' + Number(link.click_count || 0) + ' clicks</span><span>' + esc(new Date(link.created_at).toLocaleString()) + '</span><span>' + (link.is_active ? "Active" : "Disabled") + '</span></div>' +
        '<div class="link-actions"><button class="small-btn copy-short" data-url="' + esc(link.short_url) + '">Copy short URL</button>' +
        (ready ? '<button class="small-btn copy-google" data-url="' + esc(link.google_share_url) + '">Copy Google URL</button>' : "") +
        '<button class="small-btn danger disable-link" data-id="' + esc(link.id) + '">Disable</button></div>' +
        (!ready && link.is_active ? '<div class="capture-row"><input type="url" class="google-input" placeholder="Paste genuine https://share.google/... URL" aria-label="Google share URL"><button class="small-btn save-google" data-id="' + esc(link.id) + '">Save Google link</button></div>' : "") +
        (ready ? '<div class="link-dest">Google URL: ' + esc(link.google_share_url) + '</div>' : "") +
        '</article>';
    }).join("");
  }

  async function loadRequests() {
    const result = await invoke("canvau-api", { initData, action: "admin_pending" });
    const requests = result.requests || [];
    if (!requests.length) {
      byId("requests-list").innerHTML = '<div class="empty">No pending access requests.</div>';
      return;
    }
    byId("requests-list").innerHTML = requests.map((request) => {
      const user = request.user || {};
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram user";
      return '<div class="request-card"><div><div class="request-name">' + esc(name) + '</div><div class="request-sub">ID ' + esc(request.telegram_id) + (user.username ? " · @" + esc(user.username) : "") + '</div></div>' +
        '<div class="request-actions"><button class="small-btn approve-request" data-id="' + esc(request.telegram_id) + '">Approve</button><button class="small-btn danger reject-request" data-id="' + esc(request.telegram_id) + '">Reject</button></div></div>';
    }).join("");
  }

  byId("create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = byId("original-url");
    const button = byId("create-btn");
    button.disabled = true;
    button.textContent = "Creating…";
    try {
      const result = await invoke("canvau-api", { initData, action: "create", originalUrl: input.value.trim() });
      const link = result.link;
      byId("created-result").innerHTML = '<strong>Canvau short link created</strong><a href="' + esc(link.short_url) + '" target="_blank" rel="noopener noreferrer">' + esc(link.short_url) + '</a><div class="link-actions"><button class="small-btn" id="copy-created">Copy short URL</button></div>';
      byId("created-result").classList.remove("hidden");
      byId("copy-created").addEventListener("click", () => copyText(link.short_url));
      input.value = "";
      toast("Short link created");
      await loadLinks();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = 'Create Canvau link <span>→</span>';
    }
  });

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied to clipboard");
    } catch {
      toast("Clipboard permission was not available");
    }
  }

  byId("links-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.classList.contains("copy-short") || button.classList.contains("copy-google")) {
        await copyText(button.dataset.url);
      } else if (button.classList.contains("save-google")) {
        const card = button.closest(".link-card");
        const input = card.querySelector(".google-input");
        await invoke("canvau-api", { initData, action: "capture_google", linkId: button.dataset.id, googleShareUrl: input.value.trim() });
        toast("Google-domain URL saved");
        await loadLinks();
      } else if (button.classList.contains("disable-link")) {
        await invoke("canvau-api", { initData, action: "delete", linkId: button.dataset.id });
        toast("Link disabled");
        await loadLinks();
      }
    } catch (error) {
      toast(error.message);
    }
  });

  byId("requests-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const approve = button.classList.contains("approve-request");
    const reject = button.classList.contains("reject-request");
    if (!approve && !reject) return;
    try {
      await invoke("canvau-api", {
        initData, action: "admin_review",
        telegramId: button.dataset.id,
        decision: approve ? "approved" : "rejected"
      });
      toast(approve ? "User approved" : "Request rejected");
      await loadRequests();
    } catch (error) {
      toast(error.message);
    }
  });

  byId("refresh-btn").addEventListener("click", async () => {
    try {
      if (initData && currentUser) {
        await loadLinks();
        if (isAdmin) await loadRequests();
        toast("Updated");
      } else {
        await authenticate();
      }
    } catch (error) {
      toast(error.message);
    }
  });

  authenticate().catch((error) => {
    setConnection("Setup needed", false);
    byId("welcome-message").textContent = error.message;
    toast(error.message);
  });
})();
