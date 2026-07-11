// CMS asset library (extracted from content.js, #36 split). Owns the content-asset
// picker: the browsable list, upload/register, per-row alt-text + archive/restore, and
// asset selection. State that is purely the picker's (assetCache, the current target
// field/kind, the trigger to refocus on close) lives here. Choosing an asset is the one
// editor-domain action — the module calls back via `applyChosenAsset(field, path, alt,
// message, kind)`, which content.js implements (it writes the value into the editor form
// and re-syncs the preview). Shared primitives ($, api, admSkeleton, admEmpty, setStatus)
// are injected; esc/confirmDialog come from util.
import { esc, confirmDialog, restoreFocusOnClose } from "../util.js?v=20260711p";

export function createContentAssets({ $, api, admSkeleton, admEmpty, setStatus, applyChosenAsset }) {
  let assetTargetField = "image";
  let assetTargetKind = "payload";
  let assetPickerTrigger = null; // control to refocus when the picker closes
  let assetCache = new Map();
  let assetSearchTimer;

  function closeAssetPicker() {
    const panel = $("contentAssetPicker");
    if (panel) panel.hidden = true;
    assetPickerTrigger?.focus();
    assetPickerTrigger = null;
  }

  function assetValue(asset = {}) {
    return asset.public_url || asset.storage_path || "";
  }

  function assetRowTemplate(asset = {}) {
    const value = assetValue(asset);
    const status = asset.status || "available";
    const storagePath = asset.storage_path || value;
    const archived = status === "archived";
    const nextStatus = archived ? "available" : "archived";
    const statusLabel = archived ? "Restore" : "Archive";
    const statusIcon = archived ? "ph-arrow-counter-clockwise" : "ph-archive";
    return `
      <div class="adm-list-row adm-content-asset-row" data-content-asset-status="${esc(status)}">
        <span class="adm-content-asset-thumb" aria-hidden="true">${value ? `<img src="${esc(value)}" alt="" loading="lazy">` : `<i class="ph ph-image"></i>`}</span>
        <span class="adm-content-asset-info">
          <b>${esc(asset.storage_path || value)}</b>
          <span>${esc(asset.alt || "No alt text")}</span>
          <small>${esc([status, asset.credit || "", asset.mime_type || ""].filter(Boolean).join(" · "))}</small>
        </span>
        <span class="adm-content-asset-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-content-asset-kind="${esc(assetTargetKind)}" data-content-asset-field="${esc(assetTargetField)}" data-content-asset-path="${esc(value)}" data-content-asset-alt="${esc(asset.alt || "")}">
            <i class="ph ph-check" aria-hidden="true"></i> Select
          </button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-asset-alt-action data-content-asset-storage-path="${esc(storagePath)}" data-capability="content.assets">
            <i class="ph ph-text-aa" aria-hidden="true"></i> Alt text
          </button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-asset-status-action data-content-asset-storage-path="${esc(storagePath)}" data-content-asset-next-status="${esc(nextStatus)}" data-capability="content.assets">
            <i class="ph ${esc(statusIcon)}" aria-hidden="true"></i> ${esc(statusLabel)}
          </button>
        </span>
      </div>
    `;
  }

  async function loadAssets() {
    const panel = $("contentAssetPicker");
    const list = $("contentAssetRows") || panel?.querySelector(".adm-list");
    if (!list) return;
    const query = new URLSearchParams();
    const q = $("contentAssetSearch")?.value.trim() || "";
    const status = $("contentAssetStatusFilter")?.value || "available";
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    list.innerHTML = admSkeleton(5);
    try {
      const path = `/api/admin/content-assets${query.toString() ? `?${query.toString()}` : ""}`;
      const data = await api(path);
      const assets = data.assets || [];
      assetCache = new Map(assets.map((asset) => [asset.storage_path || assetValue(asset), asset]));
      list.innerHTML = assets.map((asset) => assetRowTemplate(asset)).join("")
        || admEmpty("ph-image", "No assets", "Upload an image or register an existing path.");
    } catch (error) {
      list.innerHTML = admEmpty(
        "ph-warning",
        "Assets unavailable",
        error.data?.message || error.data?.error || error.message || "Try again.",
      );
    }
  }

  // Alt-text editor dialog (C9): archive/restore requires alt text, so there must
  // be a way to set it right here. Resolves to the new text, or null on cancel.
  function promptAltText(current) {
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      dlg.className = "confirm-dialog";
      dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
        <p class="confirm-dialog-msg">Describe this image for screen readers and SEO.</p>
        <label>Alt text <input class="adm-input" data-alt-input value="${esc(current || "")}" maxlength="300"></label>
        <menu class="confirm-dialog-actions">
          <button value="cancel" class="btn btn-ghost btn-sm" type="submit">Cancel</button>
          <button value="ok" class="btn btn-primary btn-sm" type="submit">Save alt text</button>
        </menu>
      </form>`;
      if (typeof dlg.showModal !== "function") { resolve(null); return; }
      document.body.appendChild(dlg);
      restoreFocusOnClose(dlg);
      dlg.addEventListener("close", () => {
        const next = dlg.returnValue === "ok" ? String(dlg.querySelector("[data-alt-input]")?.value || "").trim() : null;
        dlg.remove();
        resolve(next);
      });
      dlg.showModal();
      dlg.querySelector("[data-alt-input]")?.focus();
    });
  }

  async function editAssetAlt(button) {
    const storagePath = button.dataset.contentAssetStoragePath || "";
    const asset = assetCache.get(storagePath);
    if (!storagePath || !asset) {
      setStatus("Refresh assets before updating this asset.", "err");
      return;
    }
    const alt = await promptAltText(asset.alt || "");
    if (alt === null || alt === String(asset.alt || "").trim()) return;
    if (!alt) { setStatus("Alt text cannot be empty.", "err"); return; }
    button.disabled = true;
    setStatus("Saving alt text...");
    try {
      const result = await api("/api/admin/content-assets", {
        method: "POST",
        body: { ...asset, storage_path: storagePath, alt },
      });
      const updated = result.asset || { ...asset, alt };
      assetCache.set(updated.storage_path || storagePath, updated);
      setStatus("Alt text saved.", "ok");
      await loadAssets();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Alt text update failed.", "err");
    } finally {
      button.disabled = false;
    }
  }

  async function updateAssetStatus(button) {
    const storagePath = button.dataset.contentAssetStoragePath || "";
    const nextStatus = button.dataset.contentAssetNextStatus === "archived" ? "archived" : "available";
    const asset = assetCache.get(storagePath);
    if (!storagePath || !asset) {
      setStatus("Refresh assets before updating this asset.", "err");
      return;
    }
    const alt = String(asset.alt || "").trim();
    if (!alt) {
      setStatus("Add alt text first (Alt text button on the row), then change the status.", "err");
      return;
    }
    // Archiving hides an asset that pages may still reference — confirm. Restore is safe.
    if (nextStatus === "archived" && !(await confirmDialog("Archive this asset? Pages still referencing it will lose the image until it is restored.", { confirmText: "Archive", cancelText: "Cancel", danger: true }))) return;
    button.disabled = true;
    setStatus(nextStatus === "archived" ? "Archiving asset..." : "Restoring asset...");
    try {
      const result = await api("/api/admin/content-assets", {
        method: "POST",
        body: {
          ...asset,
          storage_path: storagePath,
          alt,
          status: nextStatus,
        },
      });
      const updated = result.asset || { ...asset, status: nextStatus };
      assetCache.set(updated.storage_path || storagePath, updated);
      setStatus(nextStatus === "archived" ? "Asset archived." : "Asset restored.", "ok");
      await loadAssets();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset status update failed.", "err");
    } finally {
      button.disabled = false;
    }
  }

  async function openAssetPicker(fieldKey, kind = "payload", trigger = null) {
    const panel = $("contentAssetPicker");
    if (!panel) return;
    assetPickerTrigger = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    assetTargetField = fieldKey || assetTargetField || "image";
    assetTargetKind = kind || "payload";
    panel.hidden = false;
    $("contentAssetSearch")?.focus();
    await loadAssets();
  }

  function assignAssetPath(button) {
    applyChosenAsset(
      button.dataset.contentAssetField || assetTargetField,
      button.dataset.contentAssetPath || "",
      button.dataset.contentAssetAlt || "",
      "Asset path inserted.",
      button.dataset.contentAssetKind || assetTargetKind,
    );
    closeAssetPicker();
  }

  async function uploadAsset() {
    const fileInput = $("contentAssetFile");
    const altInput = $("contentAssetAlt");
    const folderInput = $("contentAssetFolder");
    const file = fileInput?.files?.[0];
    const alt = altInput?.value.trim() || "";
    if (!file) {
      setStatus("Choose an image before uploading.", "err");
      return;
    }
    if (!alt) {
      setStatus("Add alt text before uploading.", "err");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("alt", alt);
    form.append("usage", assetTargetField || "image");
    form.append("folder", folderInput?.value.trim() || "cms");
    setStatus("Uploading asset...");
    try {
      const result = await api("/api/admin/content-assets", { method: "POST", body: form });
      const assetPath = result.asset?.public_url || result.asset?.storage_path || "";
      if (!assetPath) throw new Error("upload_missing_asset_path");
      if (fileInput) fileInput.value = "";
      if (altInput) altInput.value = "";
      applyChosenAsset(assetTargetField, assetPath, result.asset?.alt || alt, "Asset uploaded.", assetTargetKind);
      closeAssetPicker();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset upload failed.", "err");
    }
  }

  async function registerAsset() {
    const pathInput = $("contentAssetPath");
    const altInput = $("contentAssetPathAlt");
    const creditInput = $("contentAssetCredit");
    const storagePath = pathInput?.value.trim() || "";
    const alt = altInput?.value.trim() || "";
    if (!storagePath) {
      setStatus("Add an existing path or public URL before registering.", "err");
      return;
    }
    if (!alt) {
      setStatus("Add alt text before registering an asset.", "err");
      return;
    }
    setStatus("Registering asset...");
    try {
      const result = await api("/api/admin/content-assets", {
        method: "POST",
        body: {
          storage_path: storagePath,
          alt,
          credit: creditInput?.value.trim() || "",
          usage: [assetTargetField || "image"],
        },
      });
      if (pathInput) pathInput.value = "";
      if (altInput) altInput.value = "";
      if (creditInput) creditInput.value = "";
      applyChosenAsset(assetTargetField, assetValue(result.asset), result.asset?.alt || alt, "Asset registered.", assetTargetKind);
      closeAssetPicker();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset registration failed.", "err");
    }
  }

  function debouncedAssetSearch() {
    clearTimeout(assetSearchTimer);
    assetSearchTimer = setTimeout(() => { void loadAssets(); }, 250);
  }

  return {
    loadAssets, closeAssetPicker, openAssetPicker, editAssetAlt, updateAssetStatus,
    assignAssetPath, uploadAsset, registerAsset, debouncedAssetSearch,
  };
}
