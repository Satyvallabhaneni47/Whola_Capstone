"use strict";

const { getHttp } = require("./client");
const { fullError } = require("./contacts");
const pageTypeDetection = require("../util/pageTypeDetection");
const logger = require("../util/logger");
const { newMessageID } = require("../util/messageId");

const BRANDVIEW_DEDUPE_TTL_MS = Number(
  process.env.BRANDVIEW_DEDUPE_TTL_MS || 300000
);
const inMemoryBrandViewDedupe = new Map();

function isMeaningfulValue(v) {
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  const bad = new Set([
    "whola",
    "home",
    "homepage",
    "site",
    "default",
    "womens",
    "women",
    "mens",
    "men",
    "kids",
    "homeware",
    "just in",
    "brands",
    "sale",
    "collections",
    "jewellery",
    "earrings",
    "denim",
    "tops",
    "dresses",
  ]);
  if (bad.has(s)) return false;
  if (s.length <= 1) return false;
  if (/^\d+$/.test(s)) return false;
  if (s === "product" || s === "item") return false;
  return true;
}
function makeDedupeKey(email, sku, sessionId, productName) {
  return `${email}|${sku}|${sessionId}|${productName}`;
}

function dedupeCheck(key) {
  const now = Date.now();
  const entry = inMemoryBrandViewDedupe.get(key);
  if (entry && now - entry.ts < BRANDVIEW_DEDUPE_TTL_MS) return false;
  inMemoryBrandViewDedupe.set(key, { ts: now });
  return true;
}

async function createBrandViewObject(
  event,
  contactId,
  brandViewObjectId = "p442999208_brand_view",
  associationType = "p442999208_brand_view_to_contact",
  options = {}
) {
  const serviceName = "BrandView";
  const messageID = options.messageID || newMessageID();
  const eventLabel = options.eventLabel || "ProductViewed";

  logger.info({
    timestamp: new Date().toISOString(),
    service: serviceName,
    messageID,
    eventLabel,
    api: `brandView:${eventLabel}`,
    msg: "Route hit",
  });

  try {
    const http = getHttp();
    const email = event?.customerProperties?.email || "";
    const p = event?.productProperties || {};
    const cart = event?.cartProperties || {};

    // ⭐ FIX: Use ONLY productProperties for brand, product, category, sku
    let brandName = p.brandName || p.brand || "";
    let productName = p.productName || p.name || "";
    let categoryName = p.categoryName || p.category || "";
    let sku =
      p.sku ||
      p.skuId ||
      p.productId ||
      "";

    // ⭐ Do NOT fallback to cart items anymore
    // You explicitly requested this.

    const pageUrl = (event?.customerProperties?.lastVisitedUrl || "").toLowerCase();
    const pageType = pageTypeDetection.detectPageType({
      pageUrl,
      productProps: p,
    });

    // Only product pages create brand_view
    const eligible =
      pageType === "product" &&
      (sku || isMeaningfulValue(productName) || isMeaningfulValue(brandName));

    if (!eligible) {
      return { ok: false, reason: "not_meaningful" };
    }

    const sessionId = event?.customerProperties?.sessionId || "";
    const dedupeKey = makeDedupeKey(
      email,
      sku || productName,
      sessionId,
      productName
    );

    if (!dedupeCheck(dedupeKey)) {
      return { ok: false, reason: "deduped" };
    }

    const properties = {
      email,
      brand_name: brandName || "",
      product_name: productName || "",
      category_name: categoryName || "",   // ⭐ FIX: category preserved
      sku: String(sku || ""),
      viewed_at: new Date().toISOString(),
      session_id: sessionId,
      source: "whola_middleware",
    };

    const url = `https://api.hubapi.com/crm/v3/objects/${brandViewObjectId}`;
    const res = await http.post(url, { properties });

    const createdId = res.data?.id || null;
    if (!createdId) return { ok: false, error: "no_created_id" };

    if (contactId) {
      const assocUrl = `https://api.hubapi.com/crm/v3/associations/${brandViewObjectId}/contacts/batch/create`;
      await http.post(assocUrl, {
        inputs: [
          { from: { id: createdId }, to: { id: contactId }, type: associationType },
        ],
      });
    }

    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: fullError(err) };
  }
}

module.exports = {
  createBrandViewObject,
  isMeaningfulValue,
  _inMemoryBrandViewDedupe: inMemoryBrandViewDedupe,
  _BRANDVIEW_DEDUPE_TTL_MS: BRANDVIEW_DEDUPE_TTL_MS,
};
