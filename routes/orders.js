const router = require('express').Router();
const ctrl   = require('../controllers/orderController');
const { authenticate, authorize } = require('../middleware/auth');

// ── Public (QR customer) ───────────────────────────────────────────────────────
router.post('/customer', ctrl.placeCustomerOrder);

// ── Protected ─────────────────────────────────────────────────────────────────
router.get ('/bill/:table_id',   authenticate, ctrl.getBill);
router.get ('/',                 authenticate, ctrl.getOrders);
router.get ('/:id',              authenticate, ctrl.getOrderById);
router.post('/',                 authenticate, ctrl.createOrder);
router.patch('/:id/status',      authenticate, ctrl.updateStatus);
router.post('/request-bill',     authenticate, ctrl.requestBill);
router.post('/mark-payment',     authenticate, authorize('owner','waiter'), ctrl.markPayment);

module.exports = router;
