const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function callApi(url, options) {
  setStatus("Printing...");
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    setStatus("Printed!");
    return await res.json();
  } catch (err) {
    setStatus(err.message || "Something went wrong", true);
    throw err;
  }
}

// --- Tabs ---
document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.querySelector(`[data-tab-panel="${btn.dataset.tab}"]`).classList.remove("hidden");
  });
});

// --- Print text ---
document.getElementById("text-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = e.target.text.value;
  await callApi("/print/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  e.target.reset();
});

// --- Print image ---
document.getElementById("image-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  await callApi("/print/image", { method: "POST", body: formData });
  e.target.reset();
});

// --- Print PDF ---
document.getElementById("pdf-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  await callApi("/print/pdf", { method: "POST", body: formData });
  e.target.reset();
});

// --- Surprise me ---
document.querySelectorAll("[data-surprise-kind]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.surpriseKind || null;
    await callApi("/print/random", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
  });
});

// --- Snippet kind toggle ---
const snippetKind = document.getElementById("snippet-kind");
const snippetText = document.getElementById("snippet-text");
const snippetFile = document.getElementById("snippet-file");
snippetKind?.addEventListener("change", () => {
  const isText = snippetKind.value === "text";
  snippetText.classList.toggle("hidden", !isText);
  snippetFile.classList.toggle("hidden", isText);
});

// --- Save snippet ---
document.getElementById("snippet-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  setStatus("Saving snippet...");
  try {
    const res = await fetch("/snippets", { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    setStatus("Snippet saved!");
    window.location.reload();
  } catch (err) {
    setStatus(err.message || "Something went wrong", true);
  }
});

// --- Snippet list actions (print / delete) ---
document.getElementById("snippet-list")?.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-snippet-id]");
  if (!li) return;
  const id = li.dataset.snippetId;

  if (e.target.classList.contains("snippet-print")) {
    await callApi(`/snippets/${id}/print`, { method: "POST" });
  } else if (e.target.classList.contains("snippet-delete")) {
    if (!confirm(`Delete snippet "${li.querySelector(".snippet-name").textContent}"?`)) return;
    await callApi(`/snippets/${id}`, { method: "DELETE" });
    li.remove();
  }
});
