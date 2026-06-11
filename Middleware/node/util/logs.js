"use strict";

const DATA_ENTITY = 'hubspot_logs';
const SCHEMA = 'hubspot';

const logger = require("./logger"); // util/logger.js

async function createLogsSchema(ctx) {
  const { clients: { masterdata } } = ctx;
  try {
    const schema = await masterdata.getSchema({
      dataEntity: DATA_ENTITY,
      schema: SCHEMA,
    });

    if (!schema) {
      await masterdata.createOrUpdateSchema({
        dataEntity: DATA_ENTITY,
        schemaName: SCHEMA,
        schemaBody: {
          properties: {
            orderId: { type: 'string', title: 'Vtex Order Id' },
            message: { type: 'string', title: 'Message' },
            body: { type: 'string', title: 'Body' },
            bodyPreview: { type: 'string', title: 'Body Preview' },
            correlationId: { type: 'string', title: 'Correlation Id' }
          },
          'v-indexed': ['orderId', 'correlationId'],
          'v-security': {
            allowGetAll: false,
            publicRead: ['id', 'orderId', 'message', 'body', 'bodyPreview', 'correlationId'],
            publicWrite: ['orderId', 'message', 'body', 'bodyPreview', 'correlationId'],
            publicFilter: ['orderId', 'message', 'body', 'bodyPreview', 'correlationId'],
          },
        },
      });
      logger.info({ api: "createLogsSchema", msg: "created schema", dataEntity: DATA_ENTITY, schema: SCHEMA });
    } else {
      logger.debug({ api: "createLogsSchema", msg: "schema exists", dataEntity: DATA_ENTITY });
    }

    return { isError: false };
  } catch (e) {
    logger.error({ api: "createLogsSchema", msg: "schema error", err: logger.safeStringify(e) });
    // keep previous behavior for 304
    if (e && e.response && e.response.status === 304) return { isError: false };
    return { isError: true };
  }
}

async function addLog(ctx, log) {
  const { clients: { masterdata } } = ctx;

  // Normalize log fields
  const rawBody = (typeof log.body === 'string') ? log.body : logger.safeStringify(log.body || "");
  const bodyPreview = rawBody.length > 500 ? rawBody.slice(0, 500) + "...[truncated]" : rawBody;

  const payload = {
    orderId: log.orderId || '',
    message: log.message || '',
    body: rawBody,
    bodyPreview,
    correlationId: log.correlationId || ''
  };

  // Emit a structured console log for Splunk (API name + message)
  logger.info({
    api: "addLog",
    msg: payload.message || "addLog called",
    orderId: payload.orderId,
    correlationId: payload.correlationId,
    bodyPreview: payload.bodyPreview
  });

  try {
    await masterdata.createDocument({
      dataEntity: DATA_ENTITY,
      schema: SCHEMA,
      fields: payload,
    });
    logger.debug({ api: "addLog", msg: "masterdata.createDocument succeeded", correlationId: payload.correlationId });
  } catch (e) {
    logger.error({ api: "addLog", msg: "masterdata.createDocument failed", err: logger.safeStringify(e), correlationId: payload.correlationId });
  }
}

module.exports = {
  createLogsSchema,
  addLog
};
