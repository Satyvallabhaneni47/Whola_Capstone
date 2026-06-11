"use strict";

const deepEqual = require("fast-deep-equal");
const { sendCartToHubSpot } = require("./HubspotService");
const { Result } = require("../general/Result");
const { newMessageID } = require("../util/messageId");
const logger = require("../util/logger");

function logEvent(level, service, messageID, eventLabel, api, msg, extra = {}) {
  logger[level]({
    timestamp: new Date().toISOString(),
    service,
    messageID,
    eventLabel,
    api,
    msg,
    ...extra
  });
}

const lastCartByEmail = new Map();
const lastProductViewedByEmail = new Map();

function isLoginEvent(body) {
  const t = body?.customerProperties?.lastActivityType?.toLowerCase?.() || "";
  return t.includes("login") || t.includes("signed in") || t.includes("log in");
}

function isLogoutEvent(body) {
  const t = body?.customerProperties?.lastActivityType?.toLowerCase?.() || "";
  return t.includes("logout") || t.includes("sign out") || t.includes("signed out");
}

function isProductViewEvent(body) {
  const t = body?.customerProperties?.lastActivityType?.toLowerCase?.() || "";
  return t.includes("product view") || t.includes("product_view");
}

function cartItemsNormalized(cartProperties) {
  const items = cartProperties?.items || [];
  return items.map((i) => ({
    sku: i.sku || i.skuId || i.itemId || "",
    qty: Number(i.qty || i.quantity || 1),
    name: i.name || i.productName || "",
    price: i.price || 0,
    variant: i.variant || "",
  }));
}

function getProductKey(body) {
  const p = body?.productProperties || {};
  return (
    p.productId ||
    p.sku ||
    p.itemId ||
    p.productName ||
    `${p.brandName || ""}|${p.categoryName || ""}|${p.name || ""}`
  );
}

function computeCartDelta(prevItems = [], newItems = []) {
  const prevMap = new Map(prevItems.map((i) => [i.sku, i]));
  const newMap = new Map(newItems.map((i) => [i.sku, i]));

  const added = [];
  const removed = [];

  for (const [sku, newIt] of newMap.entries()) {
    const prevIt = prevMap.get(sku);
    if (!prevIt || newIt.qty > prevIt.qty) {
      added.push({ ...newIt, qty: newIt.qty - (prevIt?.qty || 0) });
    }
  }

  for (const [sku, prevIt] of prevMap.entries()) {
    const newIt = newMap.get(sku);
    if (!newIt || newIt.qty < prevIt.qty) {
      removed.push({ ...prevIt, qty: prevIt.qty - (newIt?.qty || 0) });
    }
  }

  let actionType = "updated";
  if (added.length && !removed.length) actionType = "added";
  if (removed.length && !added.length) actionType = "removed";

  return { added, removed, actionType };
}

async function handleLoginOrCartUpdate(ctx, next) {
  const messageID = newMessageID();
  const body = ctx.req.body;
  const result = new Result();

  let serviceName = "CartUpdate";
  if (isLoginEvent(body)) serviceName = "Login";
  if (isLogoutEvent(body)) serviceName = "Logout";

  const eventLabel = body?.customerProperties?.lastActivityType || serviceName;

  logEvent("info", serviceName, messageID, eventLabel, `route:${serviceName}`, "Route hit");

  try {
    const email = body?.customerProperties?.email;
    if (!email) {
      result.ok(false);
      ctx.body = result.data;
      return;
    }

    const masterdata = ctx?.clients?.masterdata;
    const normalized = cartItemsNormalized(body.cartProperties || {});
    const prev = lastCartByEmail.get(email) || [];
    const cartChanged = !deepEqual(prev, normalized);

    const productView = isProductViewEvent(body);
    const productKey = getProductKey(body);

    if (serviceName === "Login") {
      await sendCartToHubSpot(
        {
          customerProperties: body.customerProperties,
          productProperties: { productName: body.customerProperties.lastVisitedUrl || "" },
          cartProperties: { ...body.cartProperties },
        },
        masterdata,
        {
          includeCartItems: false,
          eventLabel: "Login",
          serviceName,
          messageID,
          forceNote: true,
        }
      );

      logEvent("info", serviceName, messageID, "Login", "hubspot:login", "Login processed");
      result.ok(true);
      ctx.body = result.data;
      return;
    }

    if (serviceName === "Logout") {
      await sendCartToHubSpot(
        {
          customerProperties: body.customerProperties,
          productProperties: { productName: body.customerProperties.lastVisitedUrl || "" },
          cartProperties: { ...body.cartProperties },
        },
        masterdata,
        {
          includeCartItems: false,
          eventLabel: "Logout",
          serviceName,
          messageID,
          forceNote: true,
        }
      );

      logEvent("info", serviceName, messageID, "Logout", "hubspot:logout", "Logout processed");
      result.ok(true);
      ctx.body = result.data;
      return;
    }

    if (!cartChanged && productView) {
      await sendCartToHubSpot(
        {
          customerProperties: body.customerProperties,
          productProperties: body.productProperties,
          cartProperties: body.cartProperties,
        },
        masterdata,
        {
          includeCartItems: false,
          eventLabel: "Product Viewed",
          serviceName: "ProductViewed",
          messageID,
          forceNote: true,
        }
      );

      lastProductViewedByEmail.set(email, { productKey, ts: Date.now() });

      logEvent("info", "ProductViewed", messageID, "Product Viewed", "hubspot:productView", "Product view processed");
      result.ok(true);
      ctx.body = result.data;
      return;
    }
//Sriragavi implemented cart delta changes--------------------------------------------------------->>
    if (cartChanged) {
      const delta = computeCartDelta(prev, normalized);
      lastCartByEmail.set(email, normalized);

      logEvent("info", "CartUpdate", messageID, "Cart Updated", "cart:update:meaningful", "Cart changed", {
        email,
        actionType: delta.actionType,
        added: delta.added,
        removed: delta.removed,
        itemCount: normalized.length,
      });

      await sendCartToHubSpot(
        {
          customerProperties: body.customerProperties,
          productProperties: body.productProperties,
          cartProperties: body.cartProperties,
        },
        masterdata,
        {
          includeCartItems: true,
          eventLabel: "Cart Updated",
          serviceName: "CartUpdate",
          messageID,
          actionType: delta.actionType,
          itemsOverride: delta.actionType === "removed" ? delta.removed : normalized,
          remainingItemsOverride: delta.actionType === "removed" ? normalized : null,
        }
      );
//------------------------------------------------------------------------------------------------------------------------->>
      result.ok(true);
      ctx.body = result.data;
      return;
    }

    result.ok(false);
  } catch (err) {
    logEvent("error", serviceName, messageID, eventLabel, `route:${serviceName}`, "Error", { err });
    result.error("Unexpected error", err);
  }

  logEvent("info", serviceName, messageID, eventLabel, `route:${serviceName}`, "Route completed");
  ctx.body = result.data;
}

module.exports = {
  handleLoginOrCartUpdate,
  setLastProductViewed: (email, productKey) =>
    lastProductViewedByEmail.set(email, { productKey, ts: Date.now() }),
  getLastProductViewed: (email) => lastProductViewedByEmail.get(email) || null,
};
