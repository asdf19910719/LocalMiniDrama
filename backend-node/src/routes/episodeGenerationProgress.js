const response = require('../response');
const { getEpisodeGenerationProgress } = require('../services/episodeGenerationProgressService');

module.exports = function episodeGenerationProgressRoutes(db, log = console) {
  return {
    get: (req, res) => {
      try {
        const episodeId = Number(req.params.episodeId);
        if (!Number.isInteger(episodeId) || episodeId <= 0) {
          return response.badRequest(res, 'episodeId 必须是正整数');
        }
        response.success(res, getEpisodeGenerationProgress(db, episodeId));
      } catch (error) {
        if (error.code === 'EPISODE_NOT_FOUND') {
          return response.notFound(res, '剧集不存在');
        }
        log.error?.('episode generation progress', { error: error.message });
        response.internalError(res, error.message);
      }
    },
  };
};
