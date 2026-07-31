const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/authMiddleware.js');

const menuController = require('../../controllers/menuController.js');

router.post('/add-item', authenticateToken, menuController.createMenuItem);
router.get('/get-items/:businessId', authenticateToken, menuController.getMenuItemsByBusiness);
router.put('/update-item/:id', authenticateToken, menuController.updateMenuItem);
router.delete('/delete-item/:id', authenticateToken, menuController.deleteMenuItem);


module.exports = router