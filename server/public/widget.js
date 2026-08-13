(function () {
  const scriptTag = document.currentScript;
  const slug = scriptTag.getAttribute("data-waitlist");
  const apiBase = new URL(scriptTag.src).origin;

  if (!slug) {
    console.error("LaunchQueue widget: missing data-waitlist attribute on the script tag");
    return;
  }

  const container = document.getElementById("launchqueue-widget");
  if (!container) {
    console.error("LaunchQueue widget: add <div id=\"launchqueue-widget\"></div> where you want it to render");
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    .lq-widget { font-family: -apple-system, sans-serif; max-width: 420px; }
    .lq-widget input { padding: 10px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; width: 60%; margin-right: 8px; box-sizing: border-box; }
    .lq-widget button { padding: 10px 18px; background: #111; color: #fff; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; }
    .lq-widget button:disabled { opacity: .6; cursor: default; }
    .lq-widget .lq-error { color: #d33; font-size: 13px; margin-top: 8px; }
    .lq-widget .lq-success { text-align: center; }
    .lq-widget .lq-position { font-size: 36px; font-weight: 600; margin: 8px 0 0; }
    .lq-widget .lq-share { background: #f5f5f5; border-radius: 8px; padding: 8px 12px; font-size: 12px; color: #666; word-break: break-all; margin: 12px 0; }
    .lq-badge { display: block; text-align: center; margin-top: 10px; font-size: 11px; color: #999; text-decoration: none; }
  `;
  document.head.appendChild(style);
  container.className = "lq-widget";

  function renderForm() {
    container.innerHTML = `
      <form id="lq-form">
        <input type="email" id="lq-email" placeholder="you@email.com" required />
        <button type="submit" id="lq-submit">Join waitlist</button>
        <div class="lq-error" id="lq-error" style="display:none;"></div>
      </form>
      <a class="lq-badge" href="${apiBase}" target="_blank" rel="noopener">Powered by LaunchQueue</a>
    `;

    document.getElementById("lq-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const email = document.getElementById("lq-email").value;
      const btn = document.getElementById("lq-submit");
      const errorEl = document.getElementById("lq-error");
      errorEl.style.display = "none";
      btn.disabled = true;
      btn.textContent = "Joining...";

      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");

      try {
        const res = await fetch(`${apiBase}/api/w/${slug}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, ref }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Something went wrong");
        renderSuccess(data);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = "block";
        btn.disabled = false;
        btn.textContent = "Join waitlist";
      }
    });
  }

  function renderSuccess(data) {
    const shareUrl = `${window.location.origin}${window.location.pathname}?ref=${data.refCode}`;
    container.innerHTML = `
      <div class="lq-success">
        <p class="lq-position">#${data.position}</p>
        <p style="color:#666;font-size:13px;margin:0;">your position on the waitlist</p>
        <div class="lq-share">${shareUrl}</div>
        <p style="color:#999;font-size:12px;">Share this link — every signup moves you up.</p>
      </div>
      <a class="lq-badge" href="${apiBase}" target="_blank" rel="noopener">Powered by LaunchQueue</a>
    `;
  }

  renderForm();
})();