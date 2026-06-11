"use strict";

const path = require("path");

// Simple authoritative page type detection used by middleware.
// Input: { pageUrl, productProps, jsonLd }
// Returns: "product" | "brand" | "category" | "brand_list" | "home" | "unknown"
function detectPageType({ pageUrl = "", productProps = {}, jsonLd = null } = {}) {
  try {
    const url = (pageUrl || "").toString().toLowerCase();
    const p = productProps || {};

    // URL heuristics
    if (!url || url === "/" || url.endsWith("/index") || url === "https://www.whola.com.au/") return "home";
    if (url.includes("/brands") && (url.endsWith("/brands") || url.includes("/brands/") || url.includes("/brand/"))) {
      // brand listing or brand landing
      // if path is exactly /brands or /brands/ -> brand_list
      if (url.endsWith("/brands") || url.endsWith("/brands/")) return "brand_list";
      // otherwise treat as brand page if path looks like /<brand-slug>
      const parts = url.split("/").filter(Boolean);
      if (parts.length >= 2 && parts[0] === "brands") return "brand";
      // fallback
      return "brand";
    }

    // product pages typically end with /p or contain a numeric id and /p
    if (url.match(/\/p$/) || url.match(/\/p(\?|$)/) || url.match(/-\d+\/p$/) || url.match(/-\d+\/p(\?|$)/) || url.match(/-\d+\/p/)) {
      return "product";
    }
    // many product URLs include "-<id>/p"
    if (url.match(/-\d+\/p/)) return "product";

    // productProps/jsonLd heuristics
    if (jsonLd && (jsonLd.productName || jsonLd.brandName || jsonLd.productId)) return "product";
    if (p && (p.productName || p.productId || p.sku || p.skuId)) {
      // ensure not a category fallback like "womens - whola" or "denim - whola"
      const name = (p.productName || "").toString().toLowerCase();
      if (name && !name.includes(" - whola") && !name.includes("whola") && name.length > 2) return "product";
    }

    // category patterns: /womens/, /mens/, /womens/jewellery/earrings, etc.
    if (url.startsWith("/womens") || url.startsWith("/mens") || url.startsWith("/kids") || url.startsWith("/homeware") || url.includes("/collections/") || url.includes("/category/") || url.match(/\/(dresses|tops|denim|shoes|jewellery|earrings|boots|t-shirts)\b/)) {
      return "category";
    }

    // brand list
    if (url.includes("/brands")) return "brand_list";

    // fallback unknown
    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

module.exports = {
  detectPageType
};
