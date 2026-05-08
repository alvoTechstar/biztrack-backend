import { storage } from '../storage.js';

const createProduct = async (req, res) => {
  try {
    const {
      name,
      sku,
      category,
      stock = 0,
      unit,
      buyingPrice,
      price,
      threshold = 0,
      businessId,
      businessUUID
    } = req.body;

    console.log('📝 Creating product for business:', businessId);

    const normalizedSku = sku.trim().toUpperCase();
    const businessIdNumber = parseInt(businessId);

    if (!name || !sku || !category || !unit || !buyingPrice || !price || !businessIdNumber) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided: name, sku, category, unit, buyingPrice, price, businessId'
      });
    }

    if (buyingPrice <= 0) {
      return res.status(400).json({ success: false, message: 'Buying price must be greater than 0' });
    }

    if (price < buyingPrice) {
      return res.status(400).json({ success: false, message: 'Price must be greater than or equal to buying price' });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication failed: User ID not found in token' });
    }

    // Check for duplicate SKU within this business
    const businessProducts = await storage.getProducts(businessIdNumber);
    const existingProduct = businessProducts.find(p => p.sku.toUpperCase() === normalizedSku);

    if (existingProduct) {
      return res.status(400).json({
        success: false,
        message: `SKU "${normalizedSku}" already exists in your business.`,
        details: { existingProductName: existingProduct.name }
      });
    }

    const product = await storage.createProduct({
      name: name.trim(),
      sku: normalizedSku,
      category: category.trim(),
      stock: parseInt(stock) || 0,
      unit: unit.trim(),
      buyingPrice: parseFloat(buyingPrice),
      price: parseFloat(price),
      threshold: parseInt(threshold) || 0,
      businessId: businessIdNumber,
      businessUUID: businessUUID || null,
      createdBy: req.user.id
    });

    console.log('✅ Product created successfully for business', businessIdNumber);

    res.status(201).json({ success: true, message: 'Product created successfully', product });
  } catch (error) {
    console.error('❌ Create product error:', error);

    // P2002 = Prisma unique constraint violation (replaces MongoDB code 11000)
    if (error.code === 'P2002') {
      return res.status(400).json({
        success: false,
        message: `SKU already exists in this business.`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error creating product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const getProductsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business ID is required' });
    }

    const businessIdNum = parseInt(businessId);
    if (isNaN(businessIdNum)) {
      return res.status(400).json({ success: false, message: 'Business ID must be a number' });
    }

    const products = await storage.getProducts(businessIdNum);

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('❌ Get products by business error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    const existingProduct = await storage.getProduct(id);
    if (!existingProduct) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Normalise SKU and check for duplicates within the same business
    if (updateData.sku) {
      updateData.sku = updateData.sku.trim().toUpperCase();

      if (updateData.sku !== existingProduct.sku) {
        const businessProducts = await storage.getProducts(existingProduct.businessId);
        const duplicate = businessProducts.find(
          p => p.sku.toUpperCase() === updateData.sku && p.id !== id
        );

        if (duplicate) {
          return res.status(400).json({
            success: false,
            message: `SKU "${updateData.sku}" already exists in your business.`,
            details: { existingProductName: duplicate.name }
          });
        }
      }
    }

    // Validate price consistency
    if (updateData.price !== undefined || updateData.buyingPrice !== undefined) {
      const price = updateData.price !== undefined ? updateData.price : existingProduct.price;
      const buyingPrice = updateData.buyingPrice !== undefined ? updateData.buyingPrice : existingProduct.buyingPrice;

      if (price < buyingPrice) {
        return res.status(400).json({ success: false, message: 'Price must be greater than or equal to buying price' });
      }
    }

    // pgStorage.updateProduct auto-calculates status from stock/threshold
    const product = await storage.updateProduct(id, updateData);

    res.status(200).json({ success: true, message: 'Product updated successfully', product });
  } catch (error) {
    console.error('❌ Update product error:', error);

    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'SKU already exists in this business.' });
    }

    res.status(500).json({ success: false, message: 'Server error updating product' });
  }
};

const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await storage.deleteProduct(id);

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.status(200).json({ success: true, message: 'Product deleted successfully', product });
  } catch (error) {
    console.error('❌ Delete product error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting product' });
  }
};

const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    if (stock === undefined) {
      return res.status(400).json({ success: false, message: 'Stock value is required' });
    }

    const existingProduct = await storage.getProduct(id);
    if (!existingProduct) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // pgStorage.updateProduct auto-calculates status from new stock + existing threshold
    const product = await storage.updateProduct(id, { stock });

    res.status(200).json({ success: true, message: 'Stock updated successfully', product });
  } catch (error) {
    console.error('❌ Update stock error:', error);
    res.status(500).json({ success: false, message: 'Server error updating stock' });
  }
};

export {
  createProduct,
  getProductsByBusiness,
  updateProduct,
  deleteProduct,
  updateProductStock
};
