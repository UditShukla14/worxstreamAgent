/**
 * Control Tower report APIs — schedules (definitions) and generated runs.
 */

import { Router } from 'express';
import ReportDefinition from '../models/ReportDefinition.js';
import ReportRun from '../models/ReportRun.js';
import {
  computeNextRunAt,
  queueReportDefinition,
} from './reportEngine.js';

function activeQuery(filter) {
  return {
    $and: [
      filter,
      { $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }] },
    ],
  };
}

function definitionToApi(doc) {
  return {
    id: String(doc._id),
    companyId: String(doc.company_id),
    name: doc.name,
    description: doc.description || '',
    entityTypes: doc.entity_types || [],
    criteriaType: doc.criteria_type,
    criteriaFields: doc.criteria_fields || [],
    intervalDays: doc.interval_days,
    runAtHourUtc: doc.run_at_hour_utc,
    active: Boolean(doc.active),
    lastRunAt: doc.last_run_at ? new Date(doc.last_run_at).toISOString() : null,
    nextRunAt: doc.next_run_at ? new Date(doc.next_run_at).toISOString() : null,
    updatedAt: (doc.updated_at || doc.created_at || new Date()).toISOString(),
  };
}

function progressToApi(doc) {
  const progress = doc.progress || { phase: 'starting', steps: [] };
  return {
    phase: progress.phase || 'starting',
    steps: (progress.steps || []).map((step) => ({
      key: step.key,
      label: step.label,
      status: step.status,
      detail: step.detail || '',
      at: step.at ? new Date(step.at).toISOString() : new Date().toISOString(),
    })),
  };
}

function runToApi(doc) {
  return {
    id: String(doc._id),
    companyId: String(doc.company_id),
    definitionId: String(doc.definition_id),
    definitionName: doc.definition_name || '',
    periodStart: new Date(doc.period_start).toISOString(),
    periodEnd: new Date(doc.period_end).toISOString(),
    status: doc.status,
    summary: doc.summary || { scanned: 0, matched: 0, estimates: 0, invoices: 0 },
    rowCount: Array.isArray(doc.rows) ? doc.rows.length : 0,
    errorMessage: doc.error_message || '',
    generatedAt: (doc.generated_at || doc.created_at || new Date()).toISOString(),
    trigger: doc.trigger === 'scheduled' ? 'scheduled' : 'manual',
    progress: progressToApi(doc),
  };
}

function runDetailToApi(doc) {
  return {
    ...runToApi(doc),
    rows: (doc.rows || []).map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      label: row.label,
      customerName: row.customer_name,
      reason: row.reason,
      snapshot: row.snapshot || {},
    })),
  };
}

function parseListPage(req, defaultPerPage = 20) {
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.per_page || req.query.limit || String(defaultPerPage)), 10) || defaultPerPage),
  );
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  return { page, perPage };
}

function clampListPage(page, perPage, total) {
  const lastPage = Math.max(1, Math.ceil(total / perPage) || 1);
  const currentPage = page > lastPage ? lastPage : page;
  return {
    skip: (currentPage - 1) * perPage,
    pagination: { currentPage, lastPage, perPage, total },
  };
}

function parseEntityTypes(body) {
  const raw = body.entityTypes ?? body.entity_types;
  if (!Array.isArray(raw)) return ['estimate', 'invoice'];
  const allowed = raw.map((item) => String(item).trim()).filter((item) => item === 'estimate' || item === 'invoice');
  return allowed.length > 0 ? allowed : ['estimate', 'invoice'];
}

function parseCriteriaFields(body) {
  const raw = body.criteriaFields ?? body.criteria_fields;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item).trim()).filter(Boolean);
}

function definitionFieldsFromBody(body, partial = false) {
  const out = {};
  if (!partial || body.name != null) out.name = String(body.name || '').trim();
  if (!partial || body.description != null) out.description = String(body.description || '').trim();
  if (!partial || body.entityTypes != null || body.entity_types != null) {
    out.entity_types = parseEntityTypes(body);
  }
  if (!partial || body.criteriaType != null || body.criteria_type != null) {
    const criteriaType = String(body.criteriaType ?? body.criteria_type ?? '').trim();
    if (criteriaType === 'missing_fields' || criteriaType === 'negative_profit') {
      out.criteria_type = criteriaType;
    }
  }
  if (!partial || body.criteriaFields != null || body.criteria_fields != null) {
    out.criteria_fields = parseCriteriaFields(body);
  }
  if (!partial || body.intervalDays != null || body.interval_days != null) {
    const days = Number(body.intervalDays ?? body.interval_days);
    out.interval_days = Number.isFinite(days) ? Math.min(90, Math.max(1, Math.round(days))) : 1;
  }
  if (!partial || body.runAtHourUtc != null || body.run_at_hour_utc != null) {
    const hour = Number(body.runAtHourUtc ?? body.run_at_hour_utc);
    out.run_at_hour_utc = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.round(hour))) : 23;
  }
  if (!partial || body.active != null) out.active = Boolean(body.active);
  return out;
}

export function createReportRouter() {
  const router = Router();

  router.get('/report-definitions', async (req, res, next) => {
    try {
      const filter = activeQuery({ company_id: req.companyId });
      const { page, perPage } = parseListPage(req);
      const total = await ReportDefinition.countDocuments(filter);
      const sliced = clampListPage(page, perPage, total);
      const rows = await ReportDefinition.find(filter)
        .sort({ updated_at: -1 })
        .skip(sliced.skip)
        .limit(perPage);
      res.json({ success: true, data: rows.map(definitionToApi), pagination: sliced.pagination });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions', async (req, res, next) => {
    try {
      const fields = definitionFieldsFromBody(req.body || {}, false);
      if (!fields.name || !fields.criteria_type) {
        return res.status(400).json({
          success: false,
          error: 'name and criteriaType are required',
        });
      }
      if (fields.criteria_type === 'missing_fields' && (!fields.criteria_fields || fields.criteria_fields.length === 0)) {
        fields.criteria_fields = ['trackingNo', 'trackingUrl', 'trackingCompany'];
      }
      const doc = await ReportDefinition.create({
        company_id: req.companyId,
        user_id: req.userId,
        ...fields,
        next_run_at: computeNextRunAt({
          interval_days: fields.interval_days ?? 1,
          run_at_hour_utc: fields.run_at_hour_utc ?? 23,
        }),
      });
      res.status(201).json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.put('/report-definitions/:id', async (req, res, next) => {
    try {
      const doc = await ReportDefinition.findOne({ _id: req.params.id, company_id: req.companyId });
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      const fields = definitionFieldsFromBody(req.body || {}, true);
      Object.assign(doc, fields);
      if (!doc.name || !doc.criteria_type) {
        return res.status(400).json({ success: false, error: 'name and criteriaType are required' });
      }
      if (doc.criteria_type === 'missing_fields' && (!doc.criteria_fields || doc.criteria_fields.length === 0)) {
        doc.criteria_fields = ['trackingNo', 'trackingUrl', 'trackingCompany'];
      }
      if (fields.interval_days != null || fields.run_at_hour_utc != null || fields.active != null) {
        doc.next_run_at = computeNextRunAt(doc);
      }
      await doc.save();
      res.json({ success: true, data: definitionToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/report-definitions/:id', async (req, res, next) => {
    try {
      const doc = await ReportDefinition.findOne({ _id: req.params.id, company_id: req.companyId });
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      doc.deleted_at = new Date();
      doc.active = false;
      await doc.save();
      res.json({ success: true, data: { id: String(doc._id) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-definitions/:id/run', async (req, res, next) => {
    try {
      const doc = await ReportDefinition.findOne(activeQuery({ _id: req.params.id, company_id: req.companyId }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report schedule not found' });
      const run = await queueReportDefinition(doc, {
        companyId: req.companyId,
        userId: req.userId,
        trigger: 'manual',
      });
      res.status(202).json({ success: true, data: runDetailToApi(run) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report-runs', async (req, res, next) => {
    try {
      const base = { company_id: String(req.companyId) };
      if (req.query.definition_id) {
        const definitionId = String(req.query.definition_id);
        const owned = await ReportDefinition.findOne(activeQuery({
          _id: definitionId,
          company_id: req.companyId,
        }));
        if (!owned) {
          return res.status(404).json({ success: false, error: 'Report schedule not found' });
        }
        base.definition_id = owned._id;
      }
      const filter = activeQuery(base);
      const { page, perPage } = parseListPage(req);
      const total = await ReportRun.countDocuments(filter);
      const sliced = clampListPage(page, perPage, total);
      const rows = await ReportRun.find(filter)
        .sort({ generated_at: -1 })
        .skip(sliced.skip)
        .limit(perPage);
      res.json({ success: true, data: rows.map(runToApi), pagination: sliced.pagination });
    } catch (error) {
      next(error);
    }
  });

  router.get('/report-runs/:id', async (req, res, next) => {
    try {
      const doc = await ReportRun.findOne(activeQuery({
        _id: req.params.id,
        company_id: String(req.companyId),
      }));
      if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
      res.json({ success: true, data: runDetailToApi(doc) });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/report-runs/:id', async (req, res, next) => {
    try {
      const doc = await ReportRun.findOne({
        _id: req.params.id,
        company_id: String(req.companyId),
      });
      if (!doc) return res.status(404).json({ success: false, error: 'Report not found' });
      doc.deleted_at = new Date();
      await doc.save();
      res.json({ success: true, data: { id: String(doc._id) } });
    } catch (error) {
      next(error);
    }
  });

  router.post('/report-runs/delete', async (req, res, next) => {
    try {
      const raw = req.body?.runIds ?? req.body?.run_ids ?? req.body?.ids;
      const runIds = Array.isArray(raw)
        ? raw.map((item) => String(item).trim()).filter(Boolean)
        : [];
      if (runIds.length === 0) {
        return res.status(400).json({ success: false, error: 'runIds is required' });
      }
      const result = await ReportRun.updateMany(
        {
          _id: { $in: runIds },
          company_id: String(req.companyId),
          $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }],
        },
        { $set: { deleted_at: new Date() } },
      );
      res.json({
        success: true,
        data: { deleted: result.modifiedCount ?? 0 },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}