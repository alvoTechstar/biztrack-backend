const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/authMiddleware.js');

const productController = require('../../controllers/productController.js');

router.post('/add-product', authenticateToken, productController.createProduct);
router.get('/get-products/:businessId', authenticateToken, productController.getProductsByBusiness);
router.put('/update-stock/:id', authenticateToken, productController.updateProductStock);
router.put('/update-product/:id', authenticateToken, productController.updateProduct);
router.delete('/delete-product/:id', authenticateToken, productController.deleteProduct);



module.exports = router;