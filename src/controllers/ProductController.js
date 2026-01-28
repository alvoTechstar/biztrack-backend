import Product from '../models/Product.js';

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
    console.log('📝 Product SKU:', sku);

    // Normalize SKU
    const normalizedSku = sku.trim().toUpperCase();

    // Convert businessId to Number
    const businessIdNumber = parseInt(businessId);

    // Validate required fields
    if (!name || !sku || !category || !unit || !buyingPrice || !price || !businessIdNumber) {
      return res.status(400).json({
        success: false,
        message: 'All required fields must be provided: name, sku, category, unit, buyingPrice, price, businessId'
      });
    }

    // Validate buyingPrice > 0
    if (buyingPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Buying price must be greater than 0'
      });
    }

    // Validate price >= buyingPrice
    if (price < buyingPrice) {
      return res.status(400).json({
        success: false,
        message: 'Price must be greater than or equal to buying price'
      });
    }

    // ✅ CHECK IF req.user.id EXISTS
    if (!req.user || !req.user.id) {
      console.error('❌ CRITICAL ERROR: req.user.id is undefined');
      return res.status(401).json({
        success: false,
        message: 'Authentication failed: User ID not found in token'
      });
    }

    // ✅ STEP 1: First get ALL products for this business
    console.log('🔍 Getting all products for business:', businessIdNumber);
    const businessProducts = await Product.find({ businessId: businessIdNumber });
    console.log(`📊 Found ${businessProducts.length} products in business ${businessIdNumber}`);

    // ✅ STEP 2: Check if SKU already exists in THIS business only
    const existingProduct = businessProducts.find(
      product => product.sku.toUpperCase() === normalizedSku
    );

    if (existingProduct) {
      console.log('❌ SKU already exists in THIS business:', {
        existingProductName: existingProduct.name,
        existingSKU: existingProduct.sku,
        businessId: existingProduct.businessId
      });

      return res.status(400).json({
        success: false,
        message: `SKU "${normalizedSku}" already exists in your business.`,
        details: {
          existingProductName: existingProduct.name
        }
      });
    }

    console.log('✅ SKU is unique in business', businessIdNumber);

    // Create product data
    const productData = {
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
    };

    console.log('📦 Creating product with data:', {
      ...productData,
      businessIdType: typeof productData.businessId
    });

    // Create product
    const product = await Product.create(productData);

    console.log('✅ Product created successfully for business', businessIdNumber);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('❌ Create product error:', error);

    // ✅ Handle MongoDB duplicate key error
    if (error.code === 11000) {
      console.error('MongoDB duplicate key error:', error.keyValue);

      // This happens when the unique index {sku: 1, businessId: 1} is violated
      // Which means SKU already exists in this business
      return res.status(400).json({
        success: false,
        message: `SKU "${error.keyValue.sku}" already exists in this business.`,
        details: {
          duplicateSKU: error.keyValue.sku,
          businessId: error.keyValue.businessId
        }
      });
    }

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error creating product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all products by business
// @route   GET /api/products/business/:businessId
// @access  Private
const getProductsByBusiness = async (req, res) => {
  try {
    const { businessId } = req.params;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business ID is required'
      });
    }

    // Parse as number
    const businessIdNum = parseInt(businessId);

    if (isNaN(businessIdNum)) {
      return res.status(400).json({
        success: false,
        message: 'Business ID must be a number'
      });
    }

    console.log('Query for products in business:', businessIdNum);

    const products = await Product.find({ businessId: businessIdNum })
      .sort({ createdAt: -1 });

    console.log(`Found ${products.length} products in business ${businessIdNum}`);

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

    console.log('📝 Updating product:', id);

    const existingProduct = await Product.findById(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Normalize SKU if being updated
    if (updateData.sku) {
      updateData.sku = updateData.sku.trim().toUpperCase();

      // ✅ Check for duplicate SKU ONLY in the SAME business
      if (updateData.sku !== existingProduct.sku) {
        console.log('🔍 Checking SKU in business:', existingProduct.businessId);

        // Get all products in this business
        const businessProducts = await Product.find({
          businessId: existingProduct.businessId
        });

        // Check if SKU already exists
        const duplicateProduct = businessProducts.find(
          product => product.sku.toUpperCase() === updateData.sku &&
            product._id.toString() !== id
        );

        if (duplicateProduct) {
          console.log('❌ SKU already exists in this business:', {
            duplicateProductName: duplicateProduct.name
          });

          return res.status(400).json({
            success: false,
            message: `SKU "${updateData.sku}" already exists in your business.`,
            details: {
              existingProductName: duplicateProduct.name
            }
          });
        }
      }
    }

    // Update status based on stock
    if (updateData.stock !== undefined || updateData.threshold !== undefined) {
      const stock = updateData.stock !== undefined ? updateData.stock : existingProduct.stock;
      const threshold = updateData.threshold !== undefined ? updateData.threshold : existingProduct.threshold;

      if (stock === 0) {
        updateData.status = 'Out of Stock';
      } else if (stock < threshold) {
        updateData.status = 'Low Stock';
      } else {
        updateData.status = 'In Stock';
      }
    }

    // Validate price
    if (updateData.price !== undefined || updateData.buyingPrice !== undefined) {
      const price = updateData.price !== undefined ? updateData.price : existingProduct.price;
      const buyingPrice = updateData.buyingPrice !== undefined ? updateData.buyingPrice : existingProduct.buyingPrice;

      if (price < buyingPrice) {
        return res.status(400).json({
          success: false,
          message: 'Price must be greater than or equal to buying price'
        });
      }
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Product updated successfully');

    res.status(200).json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('❌ Update product error:', error);

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    if (error.code === 11000) {
      console.error('MongoDB duplicate key error:', error.keyValue);
      return res.status(400).json({
        success: false,
        message: `SKU "${error.keyValue.sku}" already exists in this business.`,
        error: error.keyValue
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating product'
    });
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    console.log('🗑️ Deleting product:', id);

    const product = await Product.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    console.log('✅ Product deleted successfully:', {
      _id: product._id,
      name: product.name,
      sku: product.sku,
      businessId: product.businessId
    });

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully',
      product
    });
  } catch (error) {
    console.error('❌ Delete product error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting product'
    });
  }
};

// @desc    Update product stock
// @route   PUT /api/products/:id/stock
// @access  Private
const updateProductStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { stock } = req.body;

    console.log('📊 Updating stock for product:', id, 'new stock:', stock);

    if (stock === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Stock value is required'
      });
    }

    const existingProduct = await Product.findById(id);

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Determine new status based on stock
    let status = 'In Stock';
    if (stock === 0) {
      status = 'Out of Stock';
    } else if (stock < existingProduct.threshold) {
      status = 'Low Stock';
    }

    const product = await Product.findByIdAndUpdate(
      id,
      { stock, status },
      { new: true, runValidators: true }
    );

    console.log('✅ Stock updated successfully:', {
      _id: product._id,
      name: product.name,
      sku: product.sku,
      businessId: product.businessId,
      stock: product.stock,
      status: product.status
    });

    res.status(200).json({
      success: true,
      message: 'Stock updated successfully',
      product
    });
  } catch (error) {
    console.error('❌ Update stock error:', error);

    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: messages.join(', ')
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating stock'
    });
  }
};

// ✅ REMOVED: getProductsByLocation and getProductsByKiosk
// Use only getProductsByBusiness for all locations

export {
  createProduct,
  getProductsByBusiness,
  updateProduct,
  deleteProduct,
  updateProductStock
};