const router = require('express').Router();
const ctrl   = require('../controllers/analyticsController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('owner'));

router.get('/',           ctrl.getSummary);
router.get('/sales',      ctrl.getDailySales);
router.get('/top-items',  ctrl.getTopItems);
router.get('/peak-hours', ctrl.getPeakHours);
router.get('/tables',     ctrl.getTablePerformance);

module.exports = router;
