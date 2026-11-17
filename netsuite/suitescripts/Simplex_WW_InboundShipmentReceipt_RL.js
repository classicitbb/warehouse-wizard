/**
 * Simplex Trading Co Ltd - Warehouse Wizard Integration
 * Inbound Shipment Receiving RESTlet
 * (customscript_spx_ww_inb_receipt_rl / customdeploy_spx_ww_inb_receipt_rl)
 *
 * Receives an Inbound Shipment against one or more of the Purchase Orders
 * it carries. Built because the inboundShipment REST record supports
 * create/read/update/delete/search but NOT transform - receiving only
 * happens through the separate `receiveinboundshipment` record, which
 * NetSuite documents for SuiteScript only. See NetSuite Developer Brief,
 * "The inbound shipment receiving service", Sep 24 2026.
 *
 * FIELD IDS CONFIRMED 2026-11-16 with the GET entry point against shipment
 * IS072 (id 72). The first version used the brief's provisional ids
 * (shipmentitem, itemreceive, location), none of which exist on the
 * receiveitems sublist, so every request failed with INVALID_LINE_KEY.
 * The real ids are:
 *   uniquekey          PO line lineuniquekey (= inboundshipmentitem.shipmentitemtransaction)
 *   id                 inbound shipment line id (= inboundshipmentitem.id)
 *   receiveitem        receive checkbox
 *   receivinglocation  location
 *   quantitytobereceived, purchaseorder  (unchanged)
 * A request line's shipmentLineKey may be either the uniquekey or the id.
 *
 * `receiveinboundshipment` is not in the REST metadata-catalog (it 404s).
 * Use GET ?inboundShipmentId=123 on this RESTlet (with
 * Content-Type: application/json) to list the real field ids and values.
 *
 * Request (POST):
 * {
 *   "inboundShipmentId": "123",
 *   "externalRef": "ww-rcpt-ship-<uuid>",
 *   "lines": [
 *     {
 *       "shipmentLineKey": "4827",
 *       "quantity": 95,
 *       "location": "3",
 *       "inventoryAssignment": [
 *         {
 *           "receiptInventoryNumber": "LOT-A1",
 *           "binNumber": "20",
 *           "inventoryStatus": "1",
 *           "expirationDate": "2027-09-01",
 *           "quantity": 95
 *         }
 *       ]
 *     }
 *   ]
 * }
 * Each shipment line may appear only once per request - put several
 * lots/serials for one line in its inventoryAssignment array.
 * Extra fields (e.g. poId, lineNumber) are ignored.
 *
 * Response (success):
 *   { "ok": true, "itemReceiptIds": [], "alreadyProcessed": false }
 * itemReceiptIds is empty on a new receipt: NetSuite creates the item receipts
 * in the background after save(). Warehouse Wizard links and stamps them later.
 * A retry whose receipts are already stamped returns alreadyProcessed: true.
 *
 * Response (failure):
 *   { "ok": false, "code": "<code>", "retryable": <bool>, "error": "<message>" }
 * code is one of this script's validation codes (MISSING_FIELD, NO_LINES,
 * DUPLICATE_LINE_KEY, INVALID_LINE_KEY) or NetSuite's own error name.
 * retryable is true only for transient NetSuite errors (record changed by
 * another request, concurrency/usage limits, unexpected errors).
 *
 * Calls for the same shipment must be sent one at a time: each call saves
 * the whole shipment.
 *
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/record', 'N/search', 'N/log'], (record, search, log) => {
    'use strict';

    const RECORD_TYPE = 'receiveinboundshipment';
    const SUBLIST_ID = 'receiveitems';

    const LINE_FIELD = Object.freeze({
        // PO line lineuniquekey - what Warehouse Wizard drafts store.
        SHIPMENT_LINE_KEY: 'uniquekey',
        // Inbound shipment line id - also accepted as a shipmentLineKey.
        SHIPMENT_LINE_ID: 'id',
        RECEIVE_FLAG: 'receiveitem',
        QUANTITY_TO_RECEIVE: 'quantitytobereceived',
        LOCATION: 'receivinglocation',
        // Used only to find the item receipts the save creates (they are
        // created from the PO, not from the shipment).
        PURCHASE_ORDER: 'purchaseorder'
    });

    // Inventory detail is a subrecord on each receiveitems line, with its
    // own "inventoryassignment" sublist. Not yet confirmed on a lot-tracked
    // line - check the GET's inventoryDetailFieldIds on one before relying on it.
    const INVENTORY_DETAIL_FIELD_ID = 'inventorydetail';
    const INVENTORY_ASSIGNMENT_SUBLIST_ID = 'inventoryassignment';
    const ASSIGNMENT_FIELD = Object.freeze({
        RECEIPT_INVENTORY_NUMBER: 'receiptinventorynumber',
        BIN_NUMBER: 'binnumber',
        INVENTORY_STATUS: 'inventorystatus',
        EXPIRATION_DATE: 'expirationdate',
        QUANTITY: 'quantity'
    });

    const ITEM_RECEIPT = Object.freeze({
        TYPE: 'itemreceipt',
        EXTERNAL_REF_FIELD: 'custbody_spx_ww_external_ref'
    });

    // NetSuite error names worth retrying - everything else from NetSuite
    // (over-receipt, closed shipment, locked period, invalid values) will
    // fail the same way on every attempt.
    const RETRYABLE_ERROR_NAMES = Object.freeze([
        'RCRD_HAS_BEEN_CHANGED',
        'SSS_REQUEST_LIMIT_EXCEEDED',
        'SSS_TIME_LIMIT_EXCEEDED',
        'SSS_CONNECTION_TIME_OUT',
        'UNEXPECTED_ERROR'
    ]);

    const GET_LINE_LIMIT = 100;

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * A structured, expected failure - distinct from an unexpected
     * exception - so `post` can turn it into { ok: false, code, error }
     * instead of an unhandled 500. Never retryable.
     */
    class RestletValidationError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    const asString = (value) => (value === null || value === undefined)
        ? ''
        : String(value).trim();

    const requireField = (body, fieldName) => {
        const value = body && body[fieldName];
        if (value === null || value === undefined || asString(value) === '') {
            throw new RestletValidationError(
                'MISSING_FIELD',
                `Missing required field "${fieldName}" in the request body.`
            );
        }
        return value;
    };

    const toErrorResponse = (e) => {
        const message = e && e.message ? e.message : String(e);

        if (e instanceof RestletValidationError) {
            return { ok: false, code: e.code, retryable: false, error: message };
        }

        const name = (e && e.name) || 'UNEXPECTED_ERROR';
        return {
            ok: false,
            code: name,
            retryable: RETRYABLE_ERROR_NAMES.includes(name),
            error: message
        };
    };

    const collectSearchIds = (searchObject) => {
        const ids = [];
        searchObject.run().each((result) => {
            ids.push(result.id);
            return true;
        });
        return ids;
    };

    /**
     * Looks for item receipts already stamped with this externalRef. If
     * any are found, this request was already received and we must not
     * receive it again (brief "Behaviour" step 5).
     */
    const findExistingItemReceipts = (externalRef) => collectSearchIds(
        search.create({
            type: ITEM_RECEIPT.TYPE,
            filters: [
                [ITEM_RECEIPT.EXTERNAL_REF_FIELD, 'is', externalRef],
                'AND',
                ['mainline', 'is', 'T']
            ],
            columns: ['internalid']
        })
    );

    /**
     * Sets the inventory detail (lot/serial/bin/status) subrecord on the
     * currently selected receiveitems line from the request's
     * inventoryAssignment array. Dynamic mode: the subrecord is edited
     * with selectNewLine / setCurrentSublistValue / commitLine.
     */
    const applyInventoryAssignment = (shipmentRecord, requestLine) => {
        const assignments = Array.isArray(requestLine.inventoryAssignment)
            ? requestLine.inventoryAssignment
            : [];

        if (!assignments.length) {
            return;
        }

        const detail = shipmentRecord.getCurrentSublistSubrecord({
            sublistId: SUBLIST_ID,
            fieldId: INVENTORY_DETAIL_FIELD_ID
        });

        // Clear anything NetSuite pre-filled so only the request's
        // assignments end up on the receipt.
        for (let line = detail.getLineCount({ sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID }) - 1; line >= 0; line -= 1) {
            detail.removeLine({ sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID, line });
        }

        const setAssignmentValue = (fieldId, value) => detail.setCurrentSublistValue({
            sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID,
            fieldId,
            value
        });

        assignments.forEach((assignment) => {
            detail.selectNewLine({ sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID });

            if (assignment.receiptInventoryNumber) {
                setAssignmentValue(ASSIGNMENT_FIELD.RECEIPT_INVENTORY_NUMBER, asString(assignment.receiptInventoryNumber));
            }
            if (assignment.binNumber) {
                setAssignmentValue(ASSIGNMENT_FIELD.BIN_NUMBER, asString(assignment.binNumber));
            }
            if (assignment.inventoryStatus) {
                setAssignmentValue(ASSIGNMENT_FIELD.INVENTORY_STATUS, asString(assignment.inventoryStatus));
            }
            if (assignment.expirationDate) {
                setAssignmentValue(ASSIGNMENT_FIELD.EXPIRATION_DATE, new Date(assignment.expirationDate));
            }
            if (assignment.quantity !== undefined && assignment.quantity !== null) {
                setAssignmentValue(ASSIGNMENT_FIELD.QUANTITY, Number(assignment.quantity));
            }

            detail.commitLine({ sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID });
        });
    };

    /**
     * Builds shipmentLineKey -> request line, rejecting duplicates (two
     * lines with the same key would otherwise silently overwrite).
     */
    const indexRequestLines = (lines) => {
        const requestLinesByKey = new Map();

        lines.forEach((requestLine, index) => {
            const key = asString(requestLine && requestLine.shipmentLineKey);
            if (!key) {
                throw new RestletValidationError(
                    'MISSING_FIELD',
                    `Line ${index} is missing "shipmentLineKey".`
                );
            }
            if (requestLinesByKey.has(key)) {
                throw new RestletValidationError(
                    'DUPLICATE_LINE_KEY',
                    `shipmentLineKey "${key}" appears more than once. Send one line per ` +
                    'shipment line and put several lots/serials in its inventoryAssignment.'
                );
            }
            requestLinesByKey.set(key, requestLine);
        });

        return requestLinesByKey;
    };

    /**
     * Loads the shipment in receiving mode, applies the requested lines,
     * zeroes out every line not in the request (brief "Behaviour" step 3),
     * and saves. Returns no ids: see the note above save().
     */
    const receiveShipment = (requestBody) => {
        const inboundShipmentId = asString(requestBody.inboundShipmentId);
        const externalRef = asString(requestBody.externalRef);
        const requestLinesByKey = indexRequestLines(requestBody.lines);

        const shipmentRecord = record.load({
            type: RECORD_TYPE,
            id: inboundShipmentId,
            isDynamic: true
        });

        const lineCount = shipmentRecord.getLineCount({ sublistId: SUBLIST_ID });
        const matchedKeys = new Set();
        const sourceIds = new Set([inboundShipmentId]);

        const currentValue = (fieldId) => asString(shipmentRecord.getCurrentSublistValue({
            sublistId: SUBLIST_ID,
            fieldId
        }));

        for (let line = 0; line < lineCount; line += 1) {
            shipmentRecord.selectLine({ sublistId: SUBLIST_ID, line });

            const purchaseOrderId = currentValue(LINE_FIELD.PURCHASE_ORDER);
            if (purchaseOrderId) {
                sourceIds.add(purchaseOrderId);
            }

            // A request line may name the line by its PO line uniquekey or
            // by the shipment line id.
            const lineKey = currentValue(LINE_FIELD.SHIPMENT_LINE_KEY);
            const lineId = currentValue(LINE_FIELD.SHIPMENT_LINE_ID);
            const keysForLine = [lineKey, lineId].filter((k) => k && requestLinesByKey.has(k));

            if (keysForLine.length > 1) {
                throw new RestletValidationError(
                    'DUPLICATE_LINE_KEY',
                    `Shipment line ${lineId} was sent twice, as "${lineKey}" and as "${lineId}".`
                );
            }

            const requestLine = keysForLine.length ? requestLinesByKey.get(keysForLine[0]) : null;

            if (!requestLine) {
                // Not part of this request - explicitly zero it out so we
                // never receive more than what Warehouse Wizard asked for.
                shipmentRecord.setCurrentSublistValue({
                    sublistId: SUBLIST_ID,
                    fieldId: LINE_FIELD.RECEIVE_FLAG,
                    value: false
                });
                shipmentRecord.setCurrentSublistValue({
                    sublistId: SUBLIST_ID,
                    fieldId: LINE_FIELD.QUANTITY_TO_RECEIVE,
                    value: 0
                });
                shipmentRecord.commitLine({ sublistId: SUBLIST_ID });
                continue;
            }

            matchedKeys.add(keysForLine[0]);

            shipmentRecord.setCurrentSublistValue({
                sublistId: SUBLIST_ID,
                fieldId: LINE_FIELD.RECEIVE_FLAG,
                value: true
            });

            shipmentRecord.setCurrentSublistValue({
                sublistId: SUBLIST_ID,
                fieldId: LINE_FIELD.QUANTITY_TO_RECEIVE,
                value: Number(requestLine.quantity)
            });

            if (requestLine.location) {
                shipmentRecord.setCurrentSublistValue({
                    sublistId: SUBLIST_ID,
                    fieldId: LINE_FIELD.LOCATION,
                    value: asString(requestLine.location)
                });
            }

            applyInventoryAssignment(shipmentRecord, requestLine);

            shipmentRecord.commitLine({ sublistId: SUBLIST_ID });
        }

        const unmatchedKeys = [...requestLinesByKey.keys()]
            .filter((key) => !matchedKeys.has(key));

        if (unmatchedKeys.length) {
            throw new RestletValidationError(
                'INVALID_LINE_KEY',
                'These shipmentLineKey values were not found on inbound ' +
                `shipment ${inboundShipmentId}: ${unmatchedKeys.join(', ')}`
            );
        }

        // NetSuite creates the item receipts in the background, seconds after
        // save() returns, so they cannot be found here. Diffing receipts before
        // and after the save picked up an earlier request's receipt instead and
        // stamped it with the wrong externalRef. Warehouse Wizard now finds the
        // new receipts on its next queue run and stamps them itself.
        shipmentRecord.save();

        log.audit({
            title: 'WW inbound shipment receipt - saved',
            details: { inboundShipmentId, externalRef, purchaseOrders: [...sourceIds].filter((id) => id !== inboundShipmentId) }
        });

        return [];
    };

    // ------------------------------------------------------------------
    // Introspection entry point
    //
    // GET ?inboundShipmentId=123   (send Content-Type: application/json)
    //
    // Loads the shipment in receiving mode and reports back the record's
    // real body field ids, sublist ids, per-line field ids, every line's
    // field values (value and display text, up to GET_LINE_LIMIT lines),
    // and the inventory detail subrecord's ids on the first line.
    // Read-only, never calls .save().
    // ------------------------------------------------------------------

    const readLineValues = (shipmentRecord, lineFieldIds, line) => {
        const values = {};
        lineFieldIds.forEach((fieldId) => {
            if (fieldId === INVENTORY_DETAIL_FIELD_ID) {
                return;
            }
            try {
                const value = shipmentRecord.getSublistValue({ sublistId: SUBLIST_ID, fieldId, line });
                let text = null;
                try {
                    text = shipmentRecord.getSublistText({ sublistId: SUBLIST_ID, fieldId, line });
                } catch (textError) {
                    text = null;
                }
                values[fieldId] = (text !== null && text !== '' && String(text) !== String(value))
                    ? { value, text }
                    : value;
            } catch (valueError) {
                values[fieldId] = { error: valueError && valueError.message };
            }
        });
        return values;
    };

    const get = (requestParams) => {
        try {
            const inboundShipmentId = requireField(requestParams, 'inboundShipmentId');

            const shipmentRecord = record.load({
                type: RECORD_TYPE,
                id: asString(inboundShipmentId),
                isDynamic: true
            });

            const bodyFieldIds = shipmentRecord.getFields();
            const sublistIds = shipmentRecord.getSublists();
            const lineCount = shipmentRecord.getLineCount({ sublistId: SUBLIST_ID });

            const lineFieldIds = lineCount > 0
                ? shipmentRecord.getSublistFields({ sublistId: SUBLIST_ID })
                : [];

            const lines = [];
            for (let line = 0; line < Math.min(lineCount, GET_LINE_LIMIT); line += 1) {
                lines.push(readLineValues(shipmentRecord, lineFieldIds, line));
            }

            let inventoryDetailFieldIds = null;
            if (lineCount > 0) {
                try {
                    shipmentRecord.selectLine({ sublistId: SUBLIST_ID, line: 0 });
                    const detail = shipmentRecord.getCurrentSublistSubrecord({
                        sublistId: SUBLIST_ID,
                        fieldId: INVENTORY_DETAIL_FIELD_ID
                    });
                    inventoryDetailFieldIds = {
                        bodyFieldIds: detail.getFields(),
                        sublistIds: detail.getSublists(),
                        assignmentFieldIds: detail.getSublistFields({ sublistId: INVENTORY_ASSIGNMENT_SUBLIST_ID })
                    };
                } catch (subrecordError) {
                    inventoryDetailFieldIds = {
                        error: subrecordError && subrecordError.message
                    };
                }
            }

            return {
                ok: true,
                recordType: RECORD_TYPE,
                configuredSublistId: SUBLIST_ID,
                sublistIdExists: sublistIds.includes(SUBLIST_ID),
                configuredLineFields: LINE_FIELD,
                configuredLineFieldsMissing: Object.values(LINE_FIELD).filter((id) => !lineFieldIds.includes(id)),
                bodyFieldIds,
                sublistIds,
                lineCount,
                lineFieldIds,
                lines,
                linesTruncated: lineCount > GET_LINE_LIMIT,
                inventoryDetailFieldId: INVENTORY_DETAIL_FIELD_ID,
                inventoryDetailFieldIds
            };
        } catch (e) {
            log.error({
                title: 'WW inbound shipment introspection - failed',
                details: { message: e && e.message, name: e && e.name, requestParams }
            });

            return toErrorResponse(e);
        }
    };

    // ------------------------------------------------------------------
    // Entry point
    // ------------------------------------------------------------------

    const post = (requestBody) => {
        try {
            requireField(requestBody, 'inboundShipmentId');
            const externalRef = asString(requireField(requestBody, 'externalRef'));

            if (!Array.isArray(requestBody.lines) || !requestBody.lines.length) {
                throw new RestletValidationError(
                    'NO_LINES',
                    'The request must include at least one line in "lines".'
                );
            }

            const existingItemReceiptIds = findExistingItemReceipts(externalRef);
            if (existingItemReceiptIds.length) {
                log.audit({
                    title: 'WW inbound shipment receipt - already processed',
                    details: {
                        externalRef,
                        inboundShipmentId: requestBody.inboundShipmentId,
                        itemReceiptIds: existingItemReceiptIds
                    }
                });

                return {
                    ok: true,
                    itemReceiptIds: existingItemReceiptIds,
                    alreadyProcessed: true
                };
            }

            const itemReceiptIds = receiveShipment(requestBody);

            log.audit({
                title: 'WW inbound shipment receipt - processed',
                details: {
                    externalRef,
                    inboundShipmentId: requestBody.inboundShipmentId,
                    itemReceiptIds
                }
            });

            return {
                ok: true,
                itemReceiptIds,
                alreadyProcessed: false
            };
        } catch (e) {
            log.error({
                title: 'WW inbound shipment receipt - failed',
                details: {
                    message: e && e.message,
                    name: e && e.name,
                    requestBody
                }
            });

            return toErrorResponse(e);
        }
    };

    return { get, post };
});
