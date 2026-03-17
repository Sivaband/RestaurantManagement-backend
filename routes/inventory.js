const router = require('express').Router();
const ctrl   = require('../controllers/inventoryController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('owner'));

router.get   ('/',    ctrl.getInventory);
router.get   ('/:id', ctrl.getById);
router.post  ('/',    ctrl.createItem);
router.put   ('/:id', ctrl.updateItem);
router.delete('/:id', ctrl.deleteItem);

module.exports = router;
