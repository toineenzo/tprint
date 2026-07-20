const statusEl = document.getElementById("status");
const I18N = window.I18N || {};

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

async function callApi(url, options) {
  setStatus(I18N.status_printing || "Printing...");
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    setStatus(I18N.status_printed || "Printed!");
    return await res.json();
  } catch (err) {
    setStatus(err.message || I18N.status_error || "Something went wrong", true);
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

// --- Tasks / checklist ---
const taskRows = document.getElementById("task-rows");
const taskRowTemplate = document.getElementById("task-row-template");

function addTaskRow() {
  const fragment = taskRowTemplate.content
    ? taskRowTemplate.content.cloneNode(true)
    : document.createRange().createContextualFragment(taskRowTemplate.innerHTML);
  taskRows.appendChild(fragment);
}

document.getElementById("add-task-row")?.addEventListener("click", addTaskRow);

taskRows?.addEventListener("click", (e) => {
  if (e.target.classList.contains("task-remove")) {
    e.target.closest(".task-row").remove();
  }
});

// Start with one empty row
if (taskRows) addTaskRow();

document.getElementById("tasks-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("tasks-title").value.trim() || null;
  const mode = document.getElementById("tasks-mode").value;
  const items = Array.from(taskRows.querySelectorAll(".task-row"))
    .map((row) => ({
      text: row.querySelector(".task-text").value.trim(),
      due: row.querySelector(".task-due").value || null,
    }))
    .filter((item) => item.text);

  if (!items.length) {
    setStatus(I18N.status_error || "Something went wrong", true);
    return;
  }

  await callApi("/print/checklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, items, mode }),
  });

  taskRows.innerHTML = "";
  addTaskRow();
  document.getElementById("tasks-title").value = "";
});

// --- ICS import ---
document.getElementById("ics-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  await callApi("/print/ics", { method: "POST", body: formData });
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
  setStatus(I18N.status_saving_snippet || "Saving snippet...");
  try {
    const res = await fetch("/snippets", { method: "POST", body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    setStatus(I18N.status_snippet_saved || "Snippet saved!");
    window.location.reload();
  } catch (err) {
    setStatus(err.message || I18N.status_error || "Something went wrong", true);
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
    const name = li.querySelector(".snippet-name").textContent;
    const template = I18N.confirm_delete_snippet || 'Delete snippet "{name}"?';
    if (!confirm(template.replace("{name}", name))) return;
    await callApi(`/snippets/${id}`, { method: "DELETE" });
    li.remove();
  }
});
