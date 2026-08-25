const express = require('express');
const multer = require('multer');
const response = require('../response');
const svc = require('../services/externalGenerationService');
const refs = require('../services/externalGenerationReferenceService');
const importer = require('../services/externalGenerationImportService');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

module.exports = (db) => {
  const r = express.Router();
  const requireKey = (req) => { if (!req.get('Idempotency-Key')) throw new Error('Idempotency-Key is required'); };
  r.post('/external-generation/jobs', (req,res) => { try { requireKey(req); response.success(res, svc.createExternalJob(db, req.body || {})); } catch(e) { response.badRequest(res,e.message); } });
  r.get('/external-generation/jobs/:jobId', (req,res) => response.success(res, svc.getExternalJob(db, req.params.jobId)));
  r.post('/external-generation/jobs/:jobId/prepare', (req,res) => { try { requireKey(req); response.success(res, refs.prepareReferencePackage(db, req.params.jobId, req.body?.references || [])); } catch(e) { response.badRequest(res,e.message); } });
  r.post('/external-generation/jobs/:jobId/attempts', (req,res) => { try { requireKey(req); response.success(res, svc.createGenerationAttempt(db, req.params.jobId, req.body || {})); } catch(e) { response.badRequest(res,e.message); } });
  r.post('/external-generation/attempts/:attemptId/events', (req,res) => { try { requireKey(req); response.success(res, svc.recordAttemptEvent(db, req.params.attemptId, req.body || {})); } catch(e) { response.badRequest(res,e.message); } });
  r.get('/external-generation/dramas/:dramaId/session', (req,res) => response.success(res, svc.getProjectSession(db, req.params.dramaId, req.query.site)));
  r.post('/external-generation/dramas/:dramaId/session/attach', (req,res) => { try { requireKey(req); response.success(res, svc.attachProjectSession(db, req.params.dramaId, req.body || {})); } catch(e) { response.badRequest(res,e.message); } });
  r.post('/external-generation/results/import', upload.single('file'), async (req,res) => { try { requireKey(req); const body = { ...(req.body || {}), bytes: req.file?.buffer }; const out = await importer.importExternalResult(db, { ...body, resultIndex: Number(body.resultIndex) }); response.success(res, out); } catch(e) { response.badRequest(res,e.message); } });
  r.post('/external-generation/results/:resultId/rebind', (req,res) => { try { requireKey(req); response.success(res, importer.rebindExternalResult(db, req.params.resultId, req.body?.storyboardId)); } catch(e) { response.badRequest(res,e.message); } });
  return r;
};
