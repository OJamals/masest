import { esc, confirmDialog, restoreFocusOnClose } from "../util.js?v=20260808a";
import {
  assetUrl,
  formatAssetBytes,
  loadSiteImageAssets,
  mergeSiteImageAssets,
  prepareImageUpload,
} from "./site-image-library.js?v=20260808a";

function assetOption(asset = {}, selectedUrl = "") {
  const url = assetUrl(asset);
  if (!url) return "";
  const label = asset.filename || asset.storage_path?.split("/").pop() || "Image";
  const selected = url === selectedUrl;
  return `<button class="shared-image-library-card${selected ? " is-selected" : ""}" type="button"
    data-shared-image-option data-shared-image-url="${esc(url)}" aria-pressed="${selected}">
    <img src="${esc(url)}" alt="" width="320" height="240" loading="lazy">
    <span>${esc(label)}</span>
  </button>`;
}

function diffValue(value = "") {
  const text = String(value);
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function replacementDiffDialog({ preview = {}, source = {}, target = {}, trigger = null } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    const changes = Array.isArray(preview.changes) ? preview.changes : [];
    dlg.className = "confirm-dialog asset-replacement-dialog";
    dlg.innerHTML = `<div class="confirm-dialog-body" data-asset-replacement-diff>
      <div class="shared-image-picker-head">
        <div><p class="adm-eyebrow">Replace everywhere</p><h2>Review every content change</h2></div>
        <button class="btn btn-ghost btn-sm" type="button" data-asset-replacement-cancel aria-label="Cancel replacement"><i class="ph ph-x" aria-hidden="true"></i> Cancel</button>
      </div>
      <div class="asset-replacement-visual">
        <figure><img src="${esc(assetUrl(source))}" alt="" width="800" height="500"><figcaption>Current image</figcaption></figure>
        <i class="ph ph-arrow-right" aria-hidden="true"></i>
        <figure><img src="${esc(assetUrl(target))}" alt="" width="800" height="500"><figcaption>New image</figcaption></figure>
      </div>
      <p><strong>${Number(preview.change_count || 0)}</strong> content entr${Number(preview.change_count || 0) === 1 ? "y" : "ies"} · <strong>${Number(preview.field_count || 0)}</strong> field${Number(preview.field_count || 0) === 1 ? "" : "s"}</p>
      <div class="asset-replacement-diffs">
        ${changes.map((change) => `<section>
          <h3>${esc(change.title || change.slug || change.type)} <small>${esc(`${change.type} · ${change.locale || "en"} · v${change.version || 0}`)}</small></h3>
          ${(change.fields || []).map((field) => `<div class="asset-replacement-field">
            <code>${esc(field.path)}</code>
            <del>${esc(diffValue(field.before))}</del>
            <ins>${esc(diffValue(field.after))}</ins>
          </div>`).join("")}
        </section>`).join("")}
      </div>
      <p class="adm-callout"><strong>Rollback:</strong> each change creates a content revision. Restore prior content from that entry’s <strong>Revisions</strong>.</p>
      <div class="confirm-dialog-actions">
        <button class="btn btn-ghost" type="button" data-asset-replacement-cancel>Keep references unchanged</button>
        <button class="btn btn-primary" type="button" data-asset-replacement-confirm>Replace in ${Number(preview.change_count || 0)} entr${Number(preview.change_count || 0) === 1 ? "y" : "ies"}</button>
      </div>
    </div>`;
    if (typeof dlg.showModal !== "function") { resolve(false); return; }
    document.body.appendChild(dlg);
    restoreFocusOnClose(dlg, trigger);
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
      dlg.close(confirmed ? "confirm" : "cancel");
    };
    dlg.querySelectorAll("[data-asset-replacement-cancel]").forEach((button) => {
      button.addEventListener("click", () => finish(false));
    });
    dlg.querySelector("[data-asset-replacement-confirm]")?.addEventListener("click", () => finish(true));
    dlg.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dlg.addEventListener("close", () => {
      dlg.remove();
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, { once: true });
    dlg.showModal();
    dlg.querySelector("[data-asset-replacement-confirm]")?.focus();
  });
}

// Shared image flow for rich text, structured CMS fields, newsletters, and products.
// One bounded dialog owns upload, search, preview, selection, and CMS metadata actions.
export function openImageLibraryPicker({
  api,
  trigger = null,
  usage = "image",
  autoOpenLibrary = false,
  allowUpload = true,
  manage = false,
} = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog shared-image-picker";
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
      <div class="shared-image-picker-head">
        <div><p class="adm-eyebrow">Image library</p><h2>Choose an image</h2></div>
        <button class="btn btn-ghost btn-sm" type="button" data-shared-image-cancel aria-label="Close image library"><i class="ph ph-x" aria-hidden="true"></i> Close</button>
      </div>
      ${allowUpload ? `<input type="file" name="image_file" accept=".avif,.jpg,.jpeg,.png,.webp,image/avif,image/jpeg,image/png,image/webp" data-shared-image-file hidden>
      <div class="shared-image-picker-actions">
        <button class="btn btn-primary" type="button" data-shared-image-attach><i class="ph ph-paperclip" aria-hidden="true"></i> Attach image</button>
        <button class="btn btn-secondary" type="button" data-shared-image-library-open><i class="ph ph-images" aria-hidden="true"></i> Browse library</button>
      </div>
      <section class="shared-image-upload" data-shared-image-upload hidden>
        <p data-shared-image-file-name class="muted"></p>
        <label class="confirm-dialog-field"><span>Alt text</span><input class="adm-input" name="image_alt" autocomplete="off" data-shared-image-alt maxlength="300" placeholder="Describe the image"></label>
        <button class="btn btn-primary" type="button" data-shared-image-upload-submit>Upload and use image</button>
      </section>` : ""}
      ${manage ? '<input type="file" name="replacement_image_file" accept=".avif,.jpg,.jpeg,.png,.webp,image/avif,image/jpeg,image/png,image/webp" data-shared-image-replace-file hidden>' : ""}
      <section class="shared-image-library" data-shared-image-library hidden aria-live="polite">
        <div class="shared-image-library-head">
          <strong>Assets <small>CMS uploads first</small></strong>
          <span data-shared-image-library-count></span>
        </div>
        <div class="shared-image-library-filters">
          <label class="search-field shared-image-library-search">
            <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
            <span class="sr-only">Search site images</span>
            <input type="search" name="site_image_search" placeholder="Search by name or alt text" data-shared-image-search>
          </label>
          ${manage ? `<select class="adm-select" name="asset_status" aria-label="Filter asset status" data-shared-image-status-filter>
            <option value="available">Available</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>` : ""}
        </div>
        <div class="shared-image-library-layout">
          <section class="shared-image-preview">
            <div class="shared-image-preview-placeholder" data-shared-image-preview-placeholder>
              <i class="ph ph-image" aria-hidden="true"></i>
              <span>Select a thumbnail to inspect it.</span>
            </div>
            <img data-shared-image-preview alt="" width="960" height="720" hidden>
            <div class="shared-image-preview-details" data-shared-image-preview-details hidden>
              <strong data-shared-image-preview-name></strong>
              <small data-shared-image-preview-meta></small>
              <label>Alt text
                <input class="adm-input" name="preview_alt" type="text" maxlength="300" data-shared-image-preview-alt>
              </label>
              <div data-shared-image-impact></div>
              <div class="shared-image-preview-actions">
                <button class="btn btn-primary" type="button" data-shared-image-confirm disabled>Select</button>
                ${manage ? '<button class="btn btn-secondary btn-sm" type="button" data-shared-image-replace hidden>Replace everywhere</button>' : ""}
                <button class="btn btn-ghost btn-sm" type="button" data-shared-image-save-alt hidden>Save alt text</button>
                <button class="btn btn-ghost btn-sm" type="button" data-shared-image-state hidden></button>
              </div>
            </div>
          </section>
          <div class="shared-image-library-grid" data-shared-image-library-grid></div>
        </div>
      </section>
      <p class="adm-status" data-shared-image-status aria-live="polite"></p>
    </form>`;
    if (typeof dlg.showModal !== "function") { resolve(null); return; }
    document.body.appendChild(dlg);
    restoreFocusOnClose(dlg, trigger);

    const fileInput = dlg.querySelector("[data-shared-image-file]");
    const attachButton = dlg.querySelector("[data-shared-image-attach]");
    const openLibraryButton = dlg.querySelector("[data-shared-image-library-open]");
    const uploadSection = dlg.querySelector("[data-shared-image-upload]");
    const uploadButton = dlg.querySelector("[data-shared-image-upload-submit]");
    const altInput = dlg.querySelector("[data-shared-image-alt]");
    const fileName = dlg.querySelector("[data-shared-image-file-name]");
    const library = dlg.querySelector("[data-shared-image-library]");
    const libraryGrid = dlg.querySelector("[data-shared-image-library-grid]");
    const libraryCount = dlg.querySelector("[data-shared-image-library-count]");
    const librarySearch = dlg.querySelector("[data-shared-image-search]");
    const statusFilter = dlg.querySelector("[data-shared-image-status-filter]");
    const preview = dlg.querySelector("[data-shared-image-preview]");
    const previewPlaceholder = dlg.querySelector("[data-shared-image-preview-placeholder]");
    const previewDetails = dlg.querySelector("[data-shared-image-preview-details]");
    const previewName = dlg.querySelector("[data-shared-image-preview-name]");
    const previewMeta = dlg.querySelector("[data-shared-image-preview-meta]");
    const previewAlt = dlg.querySelector("[data-shared-image-preview-alt]");
    const previewImpact = dlg.querySelector("[data-shared-image-impact]");
    const confirmButton = dlg.querySelector("[data-shared-image-confirm]");
    const saveAltButton = dlg.querySelector("[data-shared-image-save-alt]");
    const replaceButton = dlg.querySelector("[data-shared-image-replace]");
    const replaceFileInput = dlg.querySelector("[data-shared-image-replace-file]");
    const stateButton = dlg.querySelector("[data-shared-image-state]");
    const status = dlg.querySelector("[data-shared-image-status]");
    let selectedFile = null;
    let selectedAsset = null;
    let cmsAssets = [];
    let siteAssets = [];
    let assets = [];
    let result = null;
    let settled = false;

    const setStatus = (text = "", state = "") => {
      status.textContent = text;
      if (state) status.dataset.state = state;
      else delete status.dataset.state;
    };

    const settle = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const closeWith = (next = null) => {
      result = next;
      dlg.close(next ? "select" : "cancel");
      settle();
    };

    const paintSelection = () => {
      const url = selectedAsset ? assetUrl(selectedAsset) : "";
      libraryGrid.querySelectorAll("[data-shared-image-option]").forEach((option) => {
        const selected = option.dataset.sharedImageUrl === url;
        option.classList.toggle("is-selected", selected);
        option.setAttribute("aria-pressed", String(selected));
      });
      const hasSelection = Boolean(url);
      preview.hidden = !hasSelection;
      previewPlaceholder.hidden = hasSelection;
      previewDetails.hidden = !hasSelection;
      if (!hasSelection) {
        preview.removeAttribute("src");
        confirmButton.disabled = true;
        return;
      }
      const isSiteAsset = selectedAsset.source === "site";
      const archived = selectedAsset.status === "archived";
      const previewUrl = new URL(url, location.href);
      if (selectedAsset.sha256) previewUrl.searchParams.set("v", String(selectedAsset.sha256).slice(0, 12));
      preview.src = previewUrl.href;
      preview.alt = selectedAsset.alt || "";
      previewName.textContent = selectedAsset.filename || selectedAsset.storage_path || url;
      previewMeta.textContent = [
        isSiteAsset ? "Public site" : selectedAsset.status || "available",
        formatAssetBytes(selectedAsset.byte_size),
        selectedAsset.mime_type || "",
      ].filter(Boolean).join(" · ");
      previewAlt.value = selectedAsset.alt || "";
      previewAlt.disabled = isSiteAsset;
      const references = Array.isArray(selectedAsset.references) ? selectedAsset.references : [];
      previewImpact.innerHTML = isSiteAsset
        ? "<small>Source-controlled public-site asset.</small>"
        : `<small><strong>${references.length}</strong> content entr${references.length === 1 ? "y" : "ies"} affected</small>${references.length
          ? `<ul>${references.map((reference) => `<li><strong>${esc(reference.title || reference.slug || reference.type)}</strong> <small>${esc((reference.fields || []).join(", "))}</small></li>`).join("")}</ul>`
          : ""}`;
      confirmButton.disabled = archived;
      saveAltButton.hidden = isSiteAsset;
      if (replaceButton) replaceButton.hidden = isSiteAsset || archived;
      stateButton.hidden = isSiteAsset;
      stateButton.textContent = archived ? "Restore" : "Archive";
    };

    const renderLibrary = () => {
      const selectedUrl = selectedAsset ? assetUrl(selectedAsset) : "";
      if (selectedUrl && !assets.some((asset) => assetUrl(asset) === selectedUrl)) selectedAsset = null;
      libraryGrid.innerHTML = assets.map((asset) => assetOption(asset, selectedUrl)).join("")
        || '<p class="muted">No images match these filters.</p>';
      libraryCount.textContent = `${assets.length} image${assets.length === 1 ? "" : "s"}`;
      paintSelection();
    };

    const filterLibrary = () => {
      assets = mergeSiteImageAssets({
        cmsAssets,
        siteAssets,
        q: librarySearch?.value || "",
        status: manage ? statusFilter?.value || "available" : "available",
      });
      renderLibrary();
    };

    const loadLibrary = async () => {
      if (typeof api !== "function") return;
      if (openLibraryButton) openLibraryButton.disabled = true;
      library.hidden = false;
      libraryGrid.innerHTML = '<p class="muted">Loading images…</p>';
      try {
        const [cmsResult, siteResult] = await Promise.allSettled([
          api(`/api/admin/content-assets?status=${manage ? "all" : "available"}`),
          loadSiteImageAssets(),
        ]);
        if (cmsResult.status === "rejected" && siteResult.status === "rejected") {
          throw cmsResult.reason || siteResult.reason;
        }
        cmsAssets = cmsResult.status === "fulfilled" ? cmsResult.value.assets || [] : [];
        siteAssets = siteResult.status === "fulfilled" ? siteResult.value : [];
        filterLibrary();
        if (cmsResult.status === "rejected") {
          setStatus("Showing public-site images. Uploaded CMS assets are temporarily unavailable.", "err");
        }
      } catch (error) {
        libraryGrid.innerHTML = "";
        setStatus(error?.data?.message || error?.data?.error || error?.message || "Could not load the image library.", "err");
      } finally {
        if (openLibraryButton) openLibraryButton.disabled = false;
      }
    };

    attachButton?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      selectedFile = fileInput.files?.[0] || null;
      if (!selectedFile) return;
      fileName.textContent = selectedFile.name;
      uploadSection.hidden = false;
      setStatus();
      altInput?.focus();
    });
    openLibraryButton?.addEventListener("click", () => { void loadLibrary(); });
    librarySearch?.addEventListener("input", filterLibrary);
    statusFilter?.addEventListener("change", filterLibrary);
    uploadButton?.addEventListener("click", async () => {
      const alt = altInput?.value.trim() || "";
      if (!selectedFile) { setStatus("Attach an image first.", "err"); return; }
      if (!alt) { setStatus("Add alt text before uploading.", "err"); altInput?.focus(); return; }
      uploadButton.disabled = true;
      setStatus("Preparing upright, web-optimized image…");
      try {
        const prepared = await prepareImageUpload(selectedFile);
        const form = new FormData();
        form.append("file", prepared.file);
        form.append("alt", alt);
        form.append("usage", usage);
        form.append("folder", "cms");
        if (prepared.width) form.append("width", String(prepared.width));
        if (prepared.height) form.append("height", String(prepared.height));
        setStatus("Optimizing and uploading image…");
        const data = await api("/api/admin/content-assets", { method: "POST", body: form });
        const asset = data.asset || {};
        const url = assetUrl(asset);
        if (!url) throw new Error("upload_missing_asset_path");
        closeWith({ url, alt: asset.alt || alt });
      } catch (error) {
        setStatus(error?.data?.message || error?.data?.error || "Could not upload and optimize this image.", "err");
      } finally {
        uploadButton.disabled = false;
      }
    });
    replaceButton?.addEventListener("click", () => {
      if (!selectedAsset?.storage_path || selectedAsset.source === "site") return;
      replaceFileInput?.click();
    });
    replaceFileInput?.addEventListener("change", async () => {
      const replacement = replaceFileInput.files?.[0] || null;
      const sourceAsset = selectedAsset;
      const sourcePath = sourceAsset?.storage_path || "";
      const alt = previewAlt.value.trim() || sourceAsset?.alt || "";
      if (!replacement || !sourcePath) return;
      if (!alt) {
        setStatus("Add alt text before uploading the replacement.", "err");
        previewAlt.focus();
        replaceFileInput.value = "";
        return;
      }
      replaceButton.disabled = true;
      setStatus("Preparing upright, web-optimized replacement…");
      try {
        const prepared = await prepareImageUpload(replacement);
        const form = new FormData();
        form.append("file", prepared.file);
        form.append("alt", alt);
        form.append("usage", usage);
        form.append("folder", "cms");
        if (prepared.width) form.append("width", String(prepared.width));
        if (prepared.height) form.append("height", String(prepared.height));
        setStatus("Uploading new image without changing references…");
        const uploaded = await api("/api/admin/content-assets", { method: "POST", body: form });
        const targetAsset = uploaded.asset || {};
        const targetPath = targetAsset.storage_path || "";
        if (!targetPath) throw new Error("upload_missing_asset_path");
        if (targetPath === sourcePath) {
          throw new Error("Replacement matches the current image. No references changed.");
        }
        setStatus("Building exact content diff…");
        const planned = await api("/api/admin/content-assets", {
          method: "POST",
          body: {
            action: "preview_replace_everywhere",
            source_storage_path: sourcePath,
            target_storage_path: targetPath,
          },
        });
        const impact = planned.preview || {};
        if (!impact.change_count) {
          await loadLibrary();
          selectedAsset = cmsAssets.find((asset) => asset.storage_path === targetPath) || targetAsset;
          filterLibrary();
          setStatus("New image uploaded. No content references needed replacement.", "ok");
          return;
        }
        const confirmed = await replacementDiffDialog({
          preview: impact,
          source: sourceAsset,
          target: targetAsset,
          trigger: replaceButton,
        });
        if (!confirmed) {
          await loadLibrary();
          selectedAsset = cmsAssets.find((asset) => asset.storage_path === targetPath) || targetAsset;
          filterLibrary();
          setStatus("New image uploaded. Existing content references unchanged.");
          return;
        }
        setStatus("Replacing reviewed references and writing revisions…");
        const applied = await api("/api/admin/content-assets", {
          method: "POST",
          body: {
            action: "apply_replace_everywhere",
            source_storage_path: sourcePath,
            target_storage_path: targetPath,
            impact_hash: impact.impact_hash,
            confirm: "replace_everywhere",
          },
        });
        await loadLibrary();
        selectedAsset = cmsAssets.find((asset) => asset.storage_path === targetPath) || targetAsset;
        filterLibrary();
        setStatus(`Replaced ${applied.replaced_fields || 0} field${applied.replaced_fields === 1 ? "" : "s"} in ${applied.replaced_entries || 0} content entr${applied.replaced_entries === 1 ? "y" : "ies"}. Roll back from Revisions.`, "ok");
      } catch (error) {
        setStatus(error?.data?.message || error?.data?.error || error?.message || "Could not replace this image.", "err");
      } finally {
        replaceButton.disabled = false;
        replaceFileInput.value = "";
      }
    });
    libraryGrid.addEventListener("click", (event) => {
      const option = event.target instanceof Element ? event.target.closest("[data-shared-image-option]") : null;
      if (!option) return;
      selectedAsset = assets.find((asset) => assetUrl(asset) === option.dataset.sharedImageUrl) || null;
      paintSelection();
    });
    confirmButton.addEventListener("click", () => {
      const url = selectedAsset ? assetUrl(selectedAsset) : "";
      if (!url || selectedAsset?.status === "archived") return;
      closeWith({ url, alt: previewAlt.value.trim() || selectedAsset.alt || "" });
    });
    saveAltButton.addEventListener("click", async () => {
      const storagePath = selectedAsset?.storage_path || "";
      const alt = previewAlt.value.trim();
      if (!storagePath || !alt) { setStatus("Alt text cannot be empty.", "err"); return; }
      saveAltButton.disabled = true;
      try {
        const data = await api("/api/admin/content-assets", {
          method: "POST",
          body: { ...selectedAsset, storage_path: storagePath, alt },
        });
        selectedAsset = data.asset || { ...selectedAsset, alt };
        cmsAssets = cmsAssets.map((asset) => (
          (asset.storage_path || assetUrl(asset)) === storagePath ? selectedAsset : asset
        ));
        filterLibrary();
        setStatus("Alt text saved.", "ok");
      } catch (error) {
        setStatus(error?.data?.message || error?.data?.error || "Could not save alt text.", "err");
      } finally {
        saveAltButton.disabled = false;
      }
    });
    stateButton.addEventListener("click", async () => {
      const storagePath = selectedAsset?.storage_path || "";
      const nextStatus = selectedAsset?.status === "archived" ? "available" : "archived";
      if (!storagePath) return;
      if (nextStatus === "archived" && !(await confirmDialog("Archive this image? Existing page references remain unchanged.", { confirmText: "Archive", cancelText: "Cancel" }))) return;
      stateButton.disabled = true;
      try {
        const data = await api("/api/admin/content-assets", {
          method: "POST",
          body: { ...selectedAsset, storage_path: storagePath, alt: previewAlt.value.trim(), status: nextStatus },
        });
        selectedAsset = data.asset || { ...selectedAsset, status: nextStatus };
        cmsAssets = cmsAssets.map((asset) => (
          (asset.storage_path || assetUrl(asset)) === storagePath ? selectedAsset : asset
        ));
        filterLibrary();
        setStatus(nextStatus === "archived" ? "Image archived." : "Image restored.", "ok");
      } catch (error) {
        setStatus(error?.data?.message || error?.data?.error || "Could not update image status.", "err");
      } finally {
        stateButton.disabled = false;
      }
    });
    dlg.querySelectorAll("[data-shared-image-cancel]").forEach((button) => {
      button.addEventListener("click", () => closeWith(null));
    });
    dlg.addEventListener("close", () => { dlg.remove(); settle(); }, { once: true });
    dlg.showModal();
    if (autoOpenLibrary) {
      void loadLibrary();
      librarySearch?.focus();
    } else {
      (attachButton || openLibraryButton)?.focus();
    }
  });
}
