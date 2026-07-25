import { esc, confirmDialog, restoreFocusOnClose } from "../util.js?v=20260724c";
import {
  assetUrl,
  formatAssetBytes,
  loadSiteImageAssets,
  mergeSiteImageAssets,
} from "./site-image-library.js?v=20260724c";

const PAGE_SIZE = 4;

function assetCard(asset = {}) {
  const url = assetUrl(asset);
  if (!url) return "";
  const storagePath = asset.storage_path || url;
  const label = asset.filename || storagePath.split("/").pop() || "Image";
  const isSiteAsset = asset.source === "site";
  return `<article class="shared-image-library-card">
    <img src="${esc(url)}" alt="${esc(asset.alt || "")}" width="320" height="240" loading="lazy">
    <div>
      <b>${esc(label)}</b>
      <small>${esc([asset.alt || "No alt text", formatAssetBytes(asset.byte_size)].filter(Boolean).join(" · "))}</small>
    </div>
    <div class="shared-image-library-card-actions">
      <button class="btn btn-secondary btn-sm" type="button" data-shared-image-select data-shared-image-url="${esc(url)}" data-shared-image-alt="${esc(asset.alt || "")}">Use image</button>
      ${isSiteAsset ? "" : `<button class="btn btn-ghost btn-sm" type="button" data-shared-image-delete data-shared-image-path="${esc(storagePath)}" aria-label="Delete ${esc(label)}"><i class="ph ph-trash" aria-hidden="true"></i></button>`}
    </div>
  </article>`;
}

// Shared Blog + Newsletter picker. Every attached file is uploaded through the
// content-assets API, so it immediately becomes a reusable library asset.
export function openImageLibraryPicker({ api, trigger = null, usage = "image" } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog shared-image-picker";
    dlg.innerHTML = `<form method="dialog" class="confirm-dialog-body">
      <div class="shared-image-picker-head"><div><p class="adm-eyebrow">Image</p><h2>Choose an image</h2></div></div>
      <p class="confirm-dialog-msg">Attach a new file or choose one already in the site library.</p>
      <input type="file" name="image_file" accept=".avif,.jpg,.jpeg,.png,.webp,image/avif,image/jpeg,image/png,image/webp" data-shared-image-file hidden>
      <div class="shared-image-picker-actions">
        <button class="btn btn-primary" type="button" data-shared-image-attach><i class="ph ph-paperclip" aria-hidden="true"></i> Attach image</button>
        <button class="btn btn-secondary" type="button" data-shared-image-library-open><i class="ph ph-images" aria-hidden="true"></i> Browse library</button>
      </div>
      <section class="shared-image-upload" data-shared-image-upload hidden>
        <p data-shared-image-file-name class="muted"></p>
        <label class="confirm-dialog-field"><span>Alt text</span><input class="adm-input" name="image_alt" autocomplete="off" data-shared-image-alt maxlength="300" placeholder="Describe the image"></label>
        <button class="btn btn-primary" type="button" data-shared-image-upload-submit>Upload and use image</button>
      </section>
      <section class="shared-image-library" data-shared-image-library hidden aria-live="polite">
        <div class="shared-image-library-head"><strong>Site image library <small>CMS uploads first</small></strong><span data-shared-image-library-count></span></div>
        <label class="search-field shared-image-library-search">
          <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
          <span class="sr-only">Search site images</span>
          <input type="search" name="site_image_search" placeholder="Search images by name or alt text" data-shared-image-search>
        </label>
        <div class="shared-image-library-grid" data-shared-image-library-grid></div>
        <div class="shared-image-library-pager" data-shared-image-library-pager hidden>
          <button class="btn btn-ghost btn-sm" type="button" data-shared-image-page="previous">Previous</button>
          <span data-shared-image-page-label></span>
          <button class="btn btn-ghost btn-sm" type="button" data-shared-image-page="next">Next</button>
        </div>
      </section>
      <p class="adm-status" data-shared-image-status aria-live="polite"></p>
      <menu class="confirm-dialog-actions">
        <button value="cancel" class="btn btn-ghost btn-sm" type="button" data-shared-image-cancel>Cancel</button>
      </menu>
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
    const pager = dlg.querySelector("[data-shared-image-library-pager]");
    const pageLabel = dlg.querySelector("[data-shared-image-page-label]");
    const status = dlg.querySelector("[data-shared-image-status]");
    let selectedFile = null;
    let page = 0;
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
      setTimeout(() => dlg.remove(), 0);
    };

    const renderLibrary = () => {
      const pages = Math.max(1, Math.ceil(assets.length / PAGE_SIZE));
      page = Math.min(page, pages - 1);
      const pageAssets = assets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      libraryGrid.innerHTML = pageAssets.map(assetCard).join("") || '<p class="muted">No images in the library yet. Attach one to add it.</p>';
      libraryCount.textContent = assets.length ? `${assets.length} image${assets.length === 1 ? "" : "s"}` : "";
      pager.hidden = pages <= 1;
      pageLabel.textContent = `Page ${page + 1} of ${pages}`;
      pager.querySelector('[data-shared-image-page="previous"]').disabled = page === 0;
      pager.querySelector('[data-shared-image-page="next"]').disabled = page >= pages - 1;
    };

    const filterLibrary = () => {
      assets = mergeSiteImageAssets({
        cmsAssets,
        siteAssets,
        q: librarySearch?.value || "",
        status: "available",
      });
      page = 0;
      renderLibrary();
    };

    const loadLibrary = async () => {
      if (typeof api !== "function") return;
      openLibraryButton.disabled = true;
      library.hidden = false;
      libraryGrid.innerHTML = '<p class="muted">Loading images…</p>';
      try {
        const [cmsResult, siteResult] = await Promise.allSettled([
          api("/api/admin/content-assets?status=available"),
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
        setStatus(error?.data?.error || "Could not load the image library.", "err");
      } finally {
        openLibraryButton.disabled = false;
      }
    };

    attachButton.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      selectedFile = fileInput.files?.[0] || null;
      if (!selectedFile) return;
      fileName.textContent = selectedFile.name;
      uploadSection.hidden = false;
      setStatus();
      altInput?.focus();
    });
    openLibraryButton.addEventListener("click", () => { void loadLibrary(); });
    librarySearch?.addEventListener("input", filterLibrary);
    uploadButton.addEventListener("click", async () => {
      const alt = altInput?.value.trim() || "";
      if (!selectedFile) { setStatus("Attach an image first.", "err"); return; }
      if (!alt) { setStatus("Add alt text before uploading.", "err"); altInput?.focus(); return; }
      uploadButton.disabled = true;
      setStatus("Optimizing and uploading image…");
      try {
        const form = new FormData();
        form.append("file", selectedFile);
        form.append("alt", alt);
        form.append("usage", usage);
        form.append("folder", "cms");
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
    libraryGrid.addEventListener("click", async (event) => {
      const select = event.target instanceof Element ? event.target.closest("[data-shared-image-select]") : null;
      if (select) {
        closeWith({ url: select.dataset.sharedImageUrl || "", alt: select.dataset.sharedImageAlt || "" });
        return;
      }
      const remove = event.target instanceof Element ? event.target.closest("[data-shared-image-delete]") : null;
      const storagePath = remove?.dataset.sharedImagePath || "";
      if (!storagePath || !(await confirmDialog("Delete this image from the library? It may also remove the uploaded file from storage.", { confirmText: "Delete", cancelText: "Cancel", danger: true }))) return;
      remove.disabled = true;
      setStatus("Deleting image…");
      try {
        await api(`/api/admin/content-assets?storage_path=${encodeURIComponent(storagePath)}`, { method: "DELETE" });
        cmsAssets = cmsAssets.filter((asset) => (asset.storage_path || assetUrl(asset)) !== storagePath);
        filterLibrary();
        setStatus("Image deleted.", "ok");
      } catch (error) {
        setStatus(error?.data?.message || error?.data?.error || "Could not delete this image.", "err");
        remove.disabled = false;
      }
    });
    pager.addEventListener("click", (event) => {
      const direction = event.target instanceof Element ? event.target.closest("[data-shared-image-page]")?.dataset.sharedImagePage : "";
      if (direction === "previous") page -= 1;
      if (direction === "next") page += 1;
      renderLibrary();
    });
    dlg.querySelector("[data-shared-image-cancel]")?.addEventListener("click", () => closeWith(null));
    dlg.addEventListener("close", () => { dlg.remove(); settle(); }, { once: true });
    dlg.showModal();
    attachButton.focus();
  });
}
