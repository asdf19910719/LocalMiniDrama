const response = require('../response');
const candidateService = require('../director/candidateGroupService');
const timelineService = require('../director/timelineService');

function routes(db, log) {
  return {
    createCandidates: (req, res) => {
      try {
        const group = candidateService.createCandidateGroup(db, {
          shotId: req.params.shotId,
          candidates: req.body?.candidates || [],
        });
        response.created(res, group);
      } catch (error) {
        log.error('director candidate group create', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    getCandidates: (req, res) => {
      try {
        const group = candidateService.getCandidateGroup(db, req.params.groupId);
        if (!group) return response.notFound(res, 'candidate group not found');
        response.success(res, group);
      } catch (error) {
        log.error('director candidate group get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    reviewCandidates: (req, res) => {
      try {
        let group = candidateService.getCandidateGroup(db, req.params.groupId);
        if (!group) return response.notFound(res, 'candidate group not found');
        if (group.status === 'pending') {
          group = candidateService.startCandidateGroup(db, group.id);
        }
        if (group.status === 'running') {
          group = candidateService.moveCandidateGroupToReview(db, group.id);
        }
        if (group.status !== 'review') {
          throw new Error(`Candidate group cannot enter review from ${group.status}`);
        }
        response.success(res, group);
      } catch (error) {
        log.error('director candidate group review', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    selectCandidate: (req, res) => {
      try {
        const group = candidateService.selectCandidate(db, req.params.groupId, req.body?.candidateId || req.body?.candidate_id, {
          selectedBy: req.body?.selectedBy || req.body?.selected_by || 'user',
          reason: req.body?.reason || '',
        });
        response.success(res, group);
      } catch (error) {
        log.error('director candidate select', { error: error.message });
        response.badRequest(res, error.message);
      }
    },
    getTimeline: (req, res) => {
      try {
        const timeline = timelineService.getTimeline(db, req.params.timelineId);
        if (!timeline) return response.notFound(res, 'timeline not found');
        response.success(res, timeline);
      } catch (error) {
        log.error('director timeline get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
  };
}

module.exports = routes;
