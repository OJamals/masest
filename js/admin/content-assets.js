// CMS asset controls: reusable viewer, optimized upload, and existing-path registration.
import { assetUrl, prepareImageUpload } from "./site-image-library.js?v=20260807d";
import { openImageLibraryPicker } from "./image-library-picker.js?v=20260807d";

export function createContentAssets({ $, api, setStatus, applyChosenAsset }) {
  let assetTargetField = "image";
  let assetTargetKind = "payload";
  let assetPickerTrigger = null; // control to refocus when the picker closes

  function closeAssetPicker() {
    const panel = $("contentAssetPicker");
    if (panel && panel.dataset.contentWorkspacePersistent !== "true") panel.hidden = true;
    assetPickerTrigger?.focus();
    assetPickerTrigger = null;
  }

  async function openAssetViewer(trigger = null) {
    const details = await openImageLibraryPicker({
      api,
      trigger: trigger || assetPickerTrigger,
      usage: assetTargetField || "image",
      autoOpenLibrary: true,
      allowUpload: false,
      manage: true,
    });
    if (!details) return;
    applyChosenAsset(
      assetTargetField,
      details.url,
      details.alt,
      "Asset inserted.",
      assetTargetKind,
    );
    closeAssetPicker();
  }

  async function openAssetPicker(fieldKey, kind = "payload", trigger = null) {
    const panel = $("contentAssetPicker");
    if (!panel) return;
    assetPickerTrigger = trigger || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    assetTargetField = fieldKey || assetTargetField || "image";
    assetTargetKind = kind || "payload";
    panel.hidden = false;
    await openAssetViewer(trigger);
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
    try {
      setStatus("Preparing upright, web-optimized image…");
      const prepared = await prepareImageUpload(file);
      const form = new FormData();
      form.append("file", prepared.file);
      form.append("alt", alt);
      form.append("usage", assetTargetField || "image");
      form.append("folder", folderInput?.value.trim() || "cms");
      if (prepared.width) form.append("width", String(prepared.width));
      if (prepared.height) form.append("height", String(prepared.height));
      setStatus("Uploading optimized asset…");
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
    setStatus("Registering asset…");
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
      applyChosenAsset(assetTargetField, assetUrl(result.asset), result.asset?.alt || alt, "Asset registered.", assetTargetKind);
      closeAssetPicker();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset registration failed.", "err");
    }
  }

  return {
    closeAssetPicker, openAssetPicker, openAssetViewer, uploadAsset, registerAsset,
  };
}
