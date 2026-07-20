const statusEl = document.getElementById("status");
const I18N = window.I18N || {};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function jsonOpts(body) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function callApi(url, options) {
  setStatus(I18N.status_printing || "Printing...");
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${res.status})`);
    }
    const data = await res.json().catch(() => ({}));
    setStatus(data.status === "queued" ? I18N.status_queued || "Queued!" : I18N.status_printed || "Printed!");
    refreshAll();
    return data;
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

// --- Queue/schedule option helpers ---
function queueOptionValues(prefix) {
  const runAt = document.getElementById(`${prefix}-run-at`)?.value || null;
  const recurrence = document.getElementById(`${prefix}-recurrence`)?.value || null;
  const recurrenceTime = document.getElementById(`${prefix}-recurrence-time`)?.value || null;
  return { run_at: runAt, recurrence: recurrence || null, recurrence_time: recurrence ? recurrenceTime : null };
}

function appendQueueFields(formData, prefix) {
  const opts = queueOptionValues(prefix);
  formData.set("queue", "true");
  if (opts.run_at) formData.set("run_at", opts.run_at);
  if (opts.recurrence) {
    formData.set("recurrence", opts.recurrence);
    formData.set("recurrence_time", opts.recurrence_time || "08:00");
  }
}

// --- Text form ---
const textForm = document.getElementById("text-form");
textForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await callApi("/print/text", jsonOpts({ text: textForm.text.value }));
  textForm.reset();
});
document.querySelector('.queue-submit[data-form="text-form"]')?.addEventListener("click", async () => {
  const text = textForm.text.value;
  if (!text.trim()) return;
  await callApi("/print/text", jsonOpts({ text, queue: true, ...queueOptionValues("text") }));
  textForm.reset();
});

// --- Multipart forms (image/pdf/ics): instant + queue ---
function wireMultipartForm(formId, url, prefix) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await callApi(url, { method: "POST", body: new FormData(form) });
    form.reset();
  });
  document.querySelector(`.queue-submit[data-form="${formId}"]`)?.addEventListener("click", async () => {
    const formData = new FormData(form);
    appendQueueFields(formData, prefix);
    await callApi(url, { method: "POST", body: formData });
    form.reset();
  });
}
wireMultipartForm("image-form", "/print/image", "image");
wireMultipartForm("pdf-form", "/print/pdf", "pdf");
wireMultipartForm("ics-form", "/print/ics", "ics");

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
  if (e.target.classList.contains("task-remove")) e.target.closest(".task-row").remove();
});
if (taskRows) addTaskRow();

async function submitChecklist(queue) {
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

  const body = { title, items, mode };
  if (queue) Object.assign(body, { queue: true, ...queueOptionValues("tasks") });

  await callApi("/print/checklist", jsonOpts(body));
  taskRows.innerHTML = "";
  addTaskRow();
  document.getElementById("tasks-title").value = "";
}
document.getElementById("tasks-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  submitChecklist(false);
});
document.querySelector('.queue-submit[data-form="tasks-form"]')?.addEventListener("click", () => submitChecklist(true));

// --- Surprise me ---
document.querySelectorAll("[data-surprise-kind]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.surpriseKind || null;
    await callApi("/print/random", jsonOpts({ kind }));
  });
});

// --- Quick save-and-print ---
document.querySelectorAll(".quick-save-btn").forEach((btn) => {
  btn.addEventListener("click", () => quickSave(btn.dataset.form));
});

async function quickSave(formId) {
  const name = window.prompt(I18N.quick_save_name_prompt || "Name:");
  if (!name || !name.trim()) return;

  const fd = new FormData();
  fd.append("name", name.trim());

  if (formId === "text-form") {
    const text = textForm.text.value.trim();
    if (!text) return;
    fd.append("kind", "text");
    fd.append("text_content", text);
  } else {
    const form = document.getElementById(formId);
    const fileInput = form.querySelector('input[type="file"]');
    if (!fileInput.files.length) return;
    fd.append("kind", formId === "image-form" ? "image" : "pdf");
    fd.append("files", fileInput.files[0]);
  }

  setStatus(I18N.status_saving_snippet || "Saving snippet...");
  try {
    const res = await fetch("/snippets", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "failed");
    const data = await res.json();
    await callApi(`/snippets/${data.id}/print`, { method: "POST" });
  } catch (err) {
    setStatus(err.message || I18N.status_error || "Something went wrong", true);
  }
}

// --- Snippet kind toggle (create form) ---
const snippetKind = document.getElementById("snippet-kind");
const snippetText = document.getElementById("snippet-text");
const snippetFiles = document.getElementById("snippet-files");
const snippetFilesHint = document.getElementById("snippet-files-hint");

function applySnippetKind() {
  const kind = snippetKind.value;
  snippetText.classList.toggle("hidden", kind !== "text");
  snippetFiles.classList.toggle("hidden", kind === "text");
  snippetFilesHint.classList.toggle("hidden", kind !== "image");
  if (kind === "image") {
    snippetFiles.setAttribute("multiple", "multiple");
    snippetFiles.setAttribute("accept", "image/*");
  } else if (kind === "pdf") {
    snippetFiles.removeAttribute("multiple");
    snippetFiles.setAttribute("accept", "application/pdf");
  }
}
snippetKind?.addEventListener("change", applySnippetKind);

// --- Save snippet (create) ---
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

// --- Modal (preview / edit) ---
const modalBackdrop = document.getElementById("modal-backdrop");
const modalBody = document.getElementById("modal-body");

function openModal(html) {
  modalBody.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
}
function closeModal() {
  modalBackdrop.classList.add("hidden");
  modalBody.innerHTML = "";
}
document.getElementById("modal-close")?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

async function fetchSnippet(id) {
  const res = await fetch(`/snippets/${id}`);
  return await res.json();
}

async function openPreview(id) {
  const snippet = await fetchSnippet(id);
  let content = "";
  if (snippet.kind === "text") {
    content = `<pre class="preview-text">${escapeHtml(snippet.text_content || "")}</pre>`;
  } else if (snippet.kind === "image") {
    content = snippet.files.map((fn) => `<img class="preview-image" src="/snippets/files/${fn}" alt="" />`).join("");
  } else if (snippet.kind === "pdf") {
    const fn = snippet.files[0];
    content = `<iframe class="preview-pdf" src="/snippets/files/${fn}"></iframe>`;
  }
  openModal(`<h2>${escapeHtml(snippet.name)}</h2>${content}`);
}

async function openEdit(id) {
  const snippet = await fetchSnippet(id);
  let fields = "";
  if (snippet.kind === "text") {
    fields = `<textarea name="text_content" rows="6">${escapeHtml(snippet.text_content || "")}</textarea>`;
  } else if (snippet.kind === "image") {
    const currentFiles = snippet.files
      .map(
        (fn) => `
      <span class="edit-file-chip">
        <img src="/snippets/files/${fn}" alt="" />
        <label><input type="checkbox" name="remove_files" value="${fn}" /> ${I18N.remove_item || "Remove"}</label>
      </span>`
      )
      .join("");
    fields = `
      <p class="hint">${I18N.current_files || "Current files"}</p>
      <div class="edit-file-list">${currentFiles}</div>
      <label>${I18N.add_more_images || "Add more images"}</label>
      <input type="file" name="add_files" accept="image/*" multiple />`;
  } else if (snippet.kind === "pdf") {
    fields = `
      <p class="hint">${escapeHtml(snippet.files[0] || "")}</p>
      <label>${I18N.replace_pdf_file || "Replace PDF file"}</label>
      <input type="file" name="add_files" accept="application/pdf" />`;
  }

  openModal(`
    <h2>${I18N.edit || "Edit"}</h2>
    <form id="edit-snippet-form">
      <input type="text" name="name" value="${escapeHtml(snippet.name)}" required />
      ${fields}
      <div class="button-row">
        <button type="submit">${I18N.save_changes || "Save changes"}</button>
        <button type="button" id="edit-cancel" class="secondary-button">${I18N.cancel || "Cancel"}</button>
      </div>
    </form>
  `);

  document.getElementById("edit-cancel").addEventListener("click", closeModal);
  document.getElementById("edit-snippet-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    setStatus(I18N.status_saving || "Saving...");
    try {
      const res = await fetch(`/snippets/${id}`, { method: "PUT", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      setStatus(I18N.status_saved || "Saved!");
      closeModal();
      window.location.reload();
    } catch (err) {
      setStatus(err.message || I18N.status_error || "Something went wrong", true);
    }
  });
}

// --- Snippet list actions ---
document.getElementById("snippet-list")?.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-snippet-id]");
  if (!li) return;
  const id = li.dataset.snippetId;

  if (e.target.classList.contains("snippet-print")) {
    await callApi(`/snippets/${id}/print`, { method: "POST" });
  } else if (e.target.classList.contains("snippet-delete")) {
    const template = I18N.confirm_delete_snippet || 'Delete snippet "{name}"?';
    if (!confirm(template.replace("{name}", li.dataset.snippetName))) return;
    await fetch(`/snippets/${id}`, { method: "DELETE" });
    li.remove();
  } else if (e.target.classList.contains("snippet-preview")) {
    openPreview(id);
  } else if (e.target.classList.contains("snippet-edit")) {
    openEdit(id);
  }
});

// --- Queue panel ---
function queueStatusLabel(status) {
  return I18N[`queue_status_${status}`] || status;
}

function formatJobMeta(job) {
  const bits = [queueStatusLabel(job.status)];
  if (job.run_at) bits.push(job.run_at.replace("T", " "));
  if (job.recurrence) {
    const label = I18N[`recurrence_${job.recurrence}`] || job.recurrence;
    bits.push(`${label} @ ${job.recurrence_time || ""}`);
  }
  if (job.error) bits.push(job.error);
  return bits.join(" · ");
}

async function refreshQueue() {
  const list = document.getElementById("queue-list");
  if (!list) return;
  try {
    const res = await fetch("/queue");
    const jobs = await res.json();
    if (!jobs.length) {
      list.innerHTML = `<li class="empty">${I18N.queue_empty || "The queue is empty."}</li>`;
      return;
    }
    list.innerHTML = jobs
      .map(
        (job) => `
      <li data-job-id="${job.id}" class="queue-status-${job.status}">
        <span class="queue-label">${escapeHtml(job.label || job.kind)}</span>
        <span class="queue-meta">${escapeHtml(formatJobMeta(job))}</span>
        ${job.status === "pending" ? `<button type="button" class="danger-button queue-cancel" data-job-id="${job.id}">${I18N.cancel || "Cancel"}</button>` : ""}
      </li>`
      )
      .join("");
  } catch (err) {
    /* transient network hiccup — leave the last known list showing */
  }
}
document.getElementById("queue-list")?.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("queue-cancel")) return;
  await fetch(`/queue/${e.target.dataset.jobId}`, { method: "DELETE" });
  refreshQueue();
});
document.getElementById("run-queue-btn")?.addEventListener("click", async () => {
  setStatus(I18N.status_printing || "Printing...");
  try {
    const res = await fetch("/queue/run", { method: "POST" });
    if (!res.ok) throw new Error("failed");
    setStatus(I18N.status_queue_ran || "Queue processed.");
  } catch (err) {
    setStatus(I18N.status_error || "Something went wrong", true);
  }
  refreshAll();
});

// --- Currently printing / cancel ---
async function refreshCurrent() {
  const bar = document.getElementById("current-print-bar");
  if (!bar) return;
  try {
    const res = await fetch("/queue/current");
    const data = await res.json();
    if (data && data.label) {
      document.getElementById("current-print-label").textContent = data.label;
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
  } catch (err) {
    /* ignore */
  }
}
document.getElementById("cancel-current-btn")?.addEventListener("click", async () => {
  try {
    await fetch("/queue/cancel-current", { method: "POST" });
    setStatus(I18N.status_canceled || "Canceled.");
  } catch (err) {
    /* ignore */
  }
  refreshAll();
});

// --- History sidebar ---
async function refreshHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;
  try {
    const res = await fetch("/history");
    const entries = await res.json();
    if (!entries.length) {
      list.innerHTML = `<li class="empty">${I18N.history_empty || "Nothing printed yet."}</li>`;
      return;
    }
    list.innerHTML = entries
      .map(
        (entry) => `
      <li data-entry-id="${entry.id}">
        ${entry.has_image ? `<img class="history-thumb" src="/history/${entry.id}/image" alt="" />` : ""}
        <div class="history-meta">
          <span class="history-kind">${escapeHtml(entry.kind)}</span>
          <span class="history-time">${escapeHtml(entry.created_at)}</span>
          ${entry.preview_text ? `<p class="history-preview">${escapeHtml(entry.preview_text.slice(0, 120))}</p>` : ""}
        </div>
      </li>`
      )
      .join("");
  } catch (err) {
    /* ignore */
  }
}

async function refreshAll() {
  await Promise.all([refreshCurrent(), refreshQueue(), refreshHistory()]);
}

refreshQueue();
refreshCurrent();
setInterval(refreshAll, 5000);
