const { buildHealthReport } = require('../lib/health');

function registerHealthRoutes(app, { getPool, port }) {
    app.get('/api/health', async (req, res) => {
        try {
            const pool = typeof getPool === 'function' ? getPool() : getPool;
            const detailed = String(req.query?.detailed || '') === '1';
            const report = await buildHealthReport({
                pool,
                includeStats: detailed,
                includeOps: detailed,
                apiBaseUrl: detailed ? `http://127.0.0.1:${port}` : undefined,
            });
            res.status(report.ok ? 200 : 503).json(report);
        } catch (err) {
            res.status(503).json({
                ok: false,
                service: 'retroboard-api',
                error: err.message,
                timestamp: new Date().toISOString(),
            });
        }
    });
}

module.exports = { registerHealthRoutes };
