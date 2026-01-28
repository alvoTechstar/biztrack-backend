import Product from '../models/Product.js';

// @desc    Create a new product
// @route   POST /api/products
// @access  Private
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
      kioskId,
      businessId,
      businessUUID
    } = req.body;

    console.log('📝 Creating product with data:', {
      name,
      sku,
      category,
      stock,
      unit,
      buyingPrice,
      price,
      threshold,
      kioskId,
      businessId,
      businessUUID,
      createdBy: req.user?.id
    });

    // Normalize SKU
    const normalizedSku = sku.trim().toUpperCase();

    // Determine the ID to use
    let locationId = kioskId || businessId;
    let locationType = kioskId ? 'kioskId' : 'businessId';

    // Validate required fields
    if (!name || !sku || !category || !unit || !buyingPrice || !price || !locationId) {
      return res.status(400).json({
        success: false,
        message: `All required fields must be provided: name, sku, category, unit, buyingPrice, price, ${locationType}`
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
      console.error('   - req.user:', req.user);
      console.error('   - req.user?.id:', req.user?.id);
      return res.status(401).json({
        success: false,
        message: 'Authentication failed: User ID not found in token'
      });
    }

    // ✅ CRITICAL: Create query based on location type
    let skuCheckQuery = {};

    if (kioskId) {
      // Check SKU within same kiosk only
      skuCheckQuery = {
        sku: normalizedSku,
        kioskId: kioskId // Match exact kiosk
      };
    } else if (businessId) {
      // Check SKU within same business only
      skuCheckQuery = {
        sku: normalizedSku,
        businessId: parseInt(businessId) // Match exact business ID
      };
    }

    console.log('🔍 SKU Check Query:', skuCheckQuery);

    // ✅ Check for existing SKU ONLY in the same location
    const existingProduct = await Product.findOne(skuCheckQuery);

    if (existingProduct) {
      console.log('❌ SKU already exists in this location:', existingProduct);
      const locationName = existingProduct.kioskId ? 'kiosk' : 'business';
      return res.status(400).json({
        success: false,
        message: `SKU "${normalizedSku}" already exists in this ${locationName}.`,
        details: {
          existingProduct: {
            name: existingProduct.name,
            sku: existingProduct.sku,
            locationId: existingProduct.kioskId || existingProduct.businessId,
            locationType: existingProduct.kioskId ? 'kiosk' : 'business'
          }
        }
      });
    }

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
      createdBy: req.user.id, // This is a UUID string
      businessUUID: businessUUID || null
    };

    // Set the appropriate ID field
    if (kioskId) {
      productData.kioskId = kioskId;
      // Clear business fields for kiosk products
      delete productData.businessId;
      delete productData.businessUUID;
    } else {
      // For business products, ensure businessId is number
      productData.businessId = parseInt(businessId);
      // Clear kiosk field
      delete productData.kioskId;
    }

    console.log('📦 Final Product Data:', productData);

    // Create product
    const product = await Product.create(productData);

    console.log('✅ Product created successfully:', product);

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('❌ Create product error:', error);

    if (error.code === 11000) {
      // MongoDB duplicate key error - should be caught by our manual check above
      return res.status(400).json({
        success: false,
        message: 'Duplicate SKU detected. SKU must be unique within the same location.',
        error: error.keyValue
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

// @desc    Get all products for a kiosk or business
// @route   GET /api/products/:locationType/:locationId
// @access  Private
const getProductsByLocation = async (req, res) => {
  try {
    const { locationType, locationId } = req.params;

    if (!locationId) {
      return res.status(400).json({
        success: false,
        message: 'Location ID is required'
      });
    }

    // Build query based on location type
    let query = {};
    if (locationType === 'kiosk') {
      query.kioskId = locationId;
    } else if (locationType === 'business') {
      query.businessId = parseInt(locationId) || locationId;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid location type. Use "kiosk" or "business"'
      });
    }

    const products = await Product.find(query)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products'
    });
  }
};

// @desc    Get all products by kiosk (for backward compatibility)
// @route   GET /api/products/kiosk/:kioskId
// @access  Private
const getProductsByKiosk = async (req, res) => {
  try {
    const { kioskId } = req.params;

    if (!kioskId) {
      return res.status(400).json({
        success: false,
        message: 'Kiosk ID is required'
      });
    }

    const products = await Product.find({ kioskId })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('Get products by kiosk error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products'
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

    // Try to parse as number first, otherwise use as string
    const businessIdNum = parseInt(businessId);
    const query = isNaN(businessIdNum) ? { businessId: businessId } : { businessId: businessIdNum };

    console.log('Query for products:', query);

    // TEMPORARY FIX: Remove populate to avoid ObjectId casting error
    const products = await Product.find(query)
      .sort({ createdAt: -1 });
    // .populate('createdBy', 'firstName lastName email'); // Comment this out

    console.log(`Found ${products.length} products`);

    res.status(200).json({
      success: true,
      message: 'Products retrieved successfully',
      products,
      count: products.length
    });
  } catch (error) {
    console.error('❌ Get products by business error:', error);
    console.error('Error stack:', error.stack);

    // More detailed error information
    res.status(500).json({
      success: false,
      message: 'Server error retrieving products',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    console.log('📝 Updating product:', id, 'with data:', updateData);

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

    // ✅ CRITICAL: Check for duplicate SKU only within the same location
    if (updateData.sku && updateData.sku !== existingProduct.sku) {
      let skuCheckQuery = {
        sku: updateData.sku,
        _id: { $ne: id } // Exclude current product
      };

      // Check within same location only
      if (existingProduct.kioskId) {
        skuCheckQuery.kioskId = existingProduct.kioskId;
      } else if (existingProduct.businessId) {
        skuCheckQuery.businessId = existingProduct.businessId;
      }

      const duplicateProduct = await Product.findOne(skuCheckQuery);

      if (duplicateProduct) {
        const locationType = existingProduct.kioskId ? 'kiosk' : 'business';
        return res.status(400).json({
          success: false,
          message: `SKU "${updateData.sku}" already exists in this ${locationType}`,
          details: {
            existingProduct: {
              name: duplicateProduct.name,
              sku: duplicateProduct.sku
            }
          }
        });
      }
    }

    const product = await Product.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Product updated successfully:', product);

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
      return res.status(400).json({
        success: false,
        message: 'SKU already exists in this location',
        error: error.keyValue
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error updating product',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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

    console.log('✅ Product deleted successfully:', product);

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

    console.log('✅ Stock updated successfully:', product);

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

export {
  createProduct,
  getProductsByLocation,
  getProductsByKiosk,
  getProductsByBusiness,
  updateProduct,
  deleteProduct,
  updateProductStock
};